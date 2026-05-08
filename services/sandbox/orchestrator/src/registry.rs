use std::collections::{HashMap, VecDeque};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use uuid::Uuid;

use crate::config::Config;
use crate::error::ApiError;
use crate::fc;
use crate::vm::Vm;

const REAPER_TICK: Duration = Duration::from_secs(10);
const DEFAULT_IDLE: Duration = Duration::from_secs(600);
const POOL_IDLE: Duration = Duration::from_secs(3600);

pub struct Registry {
    pub cfg: Arc<Config>,
    vms: Mutex<HashMap<Uuid, Arc<Vm>>>,
    pool: Mutex<VecDeque<Arc<Vm>>>,
}

impl Registry {
    pub fn new(cfg: Arc<Config>) -> Self {
        Self {
            cfg,
            vms: Mutex::new(HashMap::new()),
            pool: Mutex::new(VecDeque::new()),
        }
    }

    pub async fn create(self: &Arc<Self>, timeout_ms: Option<u64>) -> Result<Arc<Vm>, ApiError> {
        {
            let vms = self.vms.lock().await;
            if vms.len() >= self.cfg.max_vms {
                return Err(ApiError::Capacity);
            }
        }

        let idle = idle_window(timeout_ms, &self.cfg);

        let prebuilt = self.pool.lock().await.pop_front();
        let vm = if let Some(vm) = prebuilt {
            vm.bump_deadline(idle);
            self.spawn_refill(1);
            vm
        } else {
            let id = Uuid::new_v4();
            let inst = fc::boot(&self.cfg, id).await?;
            let root = inst.root_dir().to_path_buf();
            Arc::new(Vm::new(id, root, inst, idle))
        };

        self.vms.lock().await.insert(vm.id, vm.clone());
        Ok(vm)
    }

    pub async fn get(&self, id: Uuid) -> Result<Arc<Vm>, ApiError> {
        self.vms
            .lock()
            .await
            .get(&id)
            .cloned()
            .ok_or(ApiError::NotFound)
    }

    pub async fn remove(&self, id: Uuid) -> Option<Arc<Vm>> {
        self.vms.lock().await.remove(&id)
    }

    pub async fn shutdown_all(&self) {
        let drained: Vec<_> = self.vms.lock().await.drain().collect();
        for (_, vm) in drained {
            vm.shutdown().await;
        }
        let pool_drain: Vec<_> = self.pool.lock().await.drain(..).collect();
        for vm in pool_drain {
            vm.shutdown().await;
        }
    }

    pub fn warmup(self: &Arc<Self>) {
        let n = self.cfg.pool_size;
        if n == 0 {
            return;
        }
        tracing::info!(pool_size = n, "warming pool");
        self.spawn_refill(n);
    }

    fn spawn_refill(self: &Arc<Self>, n: usize) {
        for _ in 0..n {
            let me = self.clone();
            tokio::spawn(async move {
                match build_pool_vm(&me.cfg).await {
                    Ok(vm) => {
                        tracing::debug!(vm = %vm.id, "pool vm ready");
                        me.pool.lock().await.push_back(vm);
                    }
                    Err(e) => tracing::warn!(err = %e, "pool refill failed"),
                }
            });
        }
    }

    pub fn spawn_idle_reaper(self: &Arc<Self>) {
        let me = self.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(REAPER_TICK);
            loop {
                tick.tick().await;
                let now = Instant::now();
                let expired: Vec<Uuid> = {
                    let vms = me.vms.lock().await;
                    vms.iter()
                        .filter(|(_, v)| v.deadline() <= now)
                        .map(|(id, _)| *id)
                        .collect()
                };
                for id in expired {
                    if let Some(vm) = me.remove(id).await {
                        tracing::info!(%id, "reaping idle vm");
                        vm.shutdown().await;
                    }
                }
            }
        });
    }
}

async fn build_pool_vm(cfg: &Config) -> anyhow::Result<Arc<Vm>> {
    let id = Uuid::new_v4();
    let inst = fc::boot(cfg, id).await?;
    let root = inst.root_dir().to_path_buf();
    Ok(Arc::new(Vm::new(id, root, inst, POOL_IDLE)))
}

fn idle_window(req: Option<u64>, cfg: &Config) -> Duration {
    let max = cfg.max_timeout;
    req.map(Duration::from_millis)
        .unwrap_or(DEFAULT_IDLE)
        .min(max)
}
