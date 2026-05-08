use std::path::PathBuf;
use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use tokio::sync::Mutex;
use uuid::Uuid;

use crate::error::ApiError;
use crate::fc::FcInstance;
use crate::vsock::VsockClient;
use sandbox_proto::{Lang, Request, Response};

pub struct ExecOutcome {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

pub struct FileOutcome {
    pub bytes: u64,
    pub data_b64: String,
}

/// Live sandbox VM: holds the FC instance and the vsock client.
pub struct Vm {
    pub id: Uuid,
    pub root: PathBuf,
    fc: Mutex<Option<FcInstance>>,
    client: VsockClient,
    deadline: StdMutex<Instant>,
}

impl Vm {
    pub fn new(id: Uuid, root: PathBuf, fc: FcInstance, idle: Duration) -> Self {
        let client = VsockClient::new(fc.vsock_uds().to_path_buf());
        Self {
            id,
            root,
            fc: Mutex::new(Some(fc)),
            client,
            deadline: StdMutex::new(Instant::now() + idle),
        }
    }

    pub fn deadline(&self) -> Instant {
        *self.deadline.lock().unwrap()
    }

    pub fn bump_deadline(&self, idle: Duration) {
        *self.deadline.lock().unwrap() = Instant::now() + idle;
    }

    fn touch(&self, min_idle: Duration) {
        let mut d = self.deadline.lock().unwrap();
        let floor = Instant::now() + min_idle;
        if *d < floor {
            *d = floor;
        }
    }

    pub async fn exec(
        &self,
        lang: Lang,
        code: String,
        timeout: Duration,
    ) -> Result<ExecOutcome, ApiError> {
        self.touch(Duration::from_secs(60));
        match self
            .call(
                Request::Exec {
                    lang,
                    code,
                    timeout_ms: timeout.as_millis() as u64,
                },
                timeout + Duration::from_secs(2),
            )
            .await?
        {
            Response::ExecResult {
                stdout,
                stderr,
                exit_code,
            } => Ok(ExecOutcome {
                stdout,
                stderr,
                exit_code,
            }),
            Response::Err { message } => Err(ApiError::Agent(message)),
            other => Err(unexpected(other)),
        }
    }

    pub async fn read_file(&self, path: String) -> Result<FileOutcome, ApiError> {
        self.touch(Duration::from_secs(60));
        match self
            .call(Request::ReadFile { path }, Duration::from_secs(30))
            .await?
        {
            Response::FileData { data_b64, bytes } => Ok(FileOutcome { bytes, data_b64 }),
            Response::Err { message } => Err(ApiError::Agent(message)),
            other => Err(unexpected(other)),
        }
    }

    pub async fn write_file(&self, path: String, data_b64: String) -> Result<(), ApiError> {
        self.touch(Duration::from_secs(60));
        match self
            .call(Request::WriteFile { path, data_b64 }, Duration::from_secs(30))
            .await?
        {
            Response::Ok => Ok(()),
            Response::Err { message } => Err(ApiError::Agent(message)),
            other => Err(unexpected(other)),
        }
    }

    async fn call(&self, req: Request, total: Duration) -> Result<Response, ApiError> {
        match tokio::time::timeout(total, self.client.call(req)).await {
            Ok(Ok(r)) => Ok(r),
            Ok(Err(e)) => {
                tracing::warn!(err = %e, vm = %self.id, "vsock call failed");
                Err(ApiError::Agent(e.to_string()))
            }
            Err(_) => Err(ApiError::Timeout),
        }
    }

    pub async fn shutdown(&self) {
        let fc = self.fc.lock().await.take();
        if let Some(mut fc) = fc {
            fc.kill().await;
        }
        if let Err(e) = tokio::fs::remove_dir_all(&self.root).await {
            if e.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(err = %e, dir = ?self.root, "cleanup root failed");
            }
        }
    }
}

fn unexpected(r: Response) -> ApiError {
    ApiError::Agent(format!("unexpected response {:?}", r))
}
