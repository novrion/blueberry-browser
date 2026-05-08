use std::collections::HashMap;
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

pub struct Registry {
    pub cfg: Arc<Config>,
    vms: Mutex<HashMap<Uuid, Arc<Vm>>>,
}

impl Registry {
    pub fn new(cfg: Arc<Config>) -> Self {
        Self {
            cfg,
            vms: Mutex::new(HashMap::new()),
        }
    }

    pub async fn create(&self, timeout_ms: Option<u64>) -> Result<Arc<Vm>, ApiError> {
        {
            let vms = self.vms.lock().await;
            if vms.len() >= self.cfg.max_vms {
                return Err(ApiError::Capacity);
            }
        }

        let id = Uuid::new_v4();
        let idle = idle_window(timeout_ms, &self.cfg);
        let inst = fc::boot(&self.cfg, id).await?;
        let root = inst.root_dir().to_path_buf();
        let vm = Arc::new(Vm::new(id, root, inst, idle));

        self.vms.lock().await.insert(id, vm.clone());
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

fn idle_window(req: Option<u64>, cfg: &Config) -> Duration {
    let max = cfg.max_timeout;
    req.map(Duration::from_millis)
        .unwrap_or(DEFAULT_IDLE)
        .min(max)
}
