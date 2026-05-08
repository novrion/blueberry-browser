//! Lifecycle of a single Firecracker process. No jailer, no networking,
//! no snapshots — just spawn FC, configure it via the management API,
//! start the VM, and wait for the in-VM agent to be reachable.

use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::json;
use tokio::process::{Child, Command};
use uuid::Uuid;

use crate::config::Config;
use crate::fc::api;
use crate::vsock::VsockClient;

/// Fixed CID inside each VM. The host UDS is per-VM so collisions don't matter.
const GUEST_CID: u32 = 3;

/// One Firecracker process and the host-side artifacts it owns.
pub struct FcInstance {
    api_sock: PathBuf,
    vsock_sock: PathBuf,
    root: PathBuf,
    child: Option<Child>,
}

impl FcInstance {
    pub fn vsock_uds(&self) -> &Path {
        &self.vsock_sock
    }

    pub fn root_dir(&self) -> &Path {
        &self.root
    }

    pub async fn kill(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
            let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
        }
        let _ = tokio::fs::remove_file(&self.api_sock).await;
        let _ = tokio::fs::remove_file(&self.vsock_sock).await;
    }
}

pub async fn boot(cfg: &Config, id: Uuid) -> Result<FcInstance> {
    let root = cfg.work_dir.join(id.to_string());
    tokio::fs::create_dir_all(&root)
        .await
        .with_context(|| format!("mkdir {:?}", root))?;
    let api_sock = root.join("fc-api.sock");
    let vsock_sock = root.join("agent.vsock");
    let log_path = root.join("fc.log");
    let _ = tokio::fs::remove_file(&api_sock).await;
    let _ = tokio::fs::remove_file(&vsock_sock).await;

    let overlay = root.join("rootfs-overlay.ext4");
    reflink_or_copy(&cfg.rootfs_path, &overlay)
        .await
        .with_context(|| format!("copy rootfs → {:?}", overlay))?;

    let child = launch_fc(cfg, id, &api_sock, &log_path).await?;
    api::wait_for_socket(&api_sock, Duration::from_secs(5)).await?;

    api::put(
        &api_sock,
        "/boot-source",
        &json!({
            "kernel_image_path": cfg.kernel_path.to_string_lossy(),
            "boot_args": cfg.boot_args,
        }),
    )
    .await?;

    api::put(
        &api_sock,
        "/drives/rootfs",
        &json!({
            "drive_id": "rootfs",
            "path_on_host": overlay.to_string_lossy(),
            "is_root_device": true,
            "is_read_only": false,
        }),
    )
    .await?;

    api::put(
        &api_sock,
        "/machine-config",
        &json!({
            "vcpu_count": cfg.vm_vcpus,
            "mem_size_mib": cfg.vm_mem_mib,
            "smt": false,
        }),
    )
    .await?;

    api::put(
        &api_sock,
        "/vsock",
        &json!({
            "guest_cid": GUEST_CID,
            "uds_path": vsock_sock.to_string_lossy(),
            "vsock_id": "agent",
        }),
    )
    .await?;

    api::put(
        &api_sock,
        "/actions",
        &json!({ "action_type": "InstanceStart" }),
    )
    .await?;

    let inst = FcInstance {
        api_sock,
        vsock_sock,
        root,
        child: Some(child),
    };

    let client = VsockClient::new(inst.vsock_sock.clone());
    client.wait_ready(Duration::from_secs(15)).await?;
    Ok(inst)
}

/// Copy a file using `cp --reflink=auto` so CoW-capable filesystems
/// (btrfs, xfs+reflink, zfs, bcachefs) share blocks until written.
/// Falls back to a full copy on non-CoW fs.
async fn reflink_or_copy(src: &Path, dst: &Path) -> Result<()> {
    let status = Command::new("cp")
        .arg("--reflink=auto")
        .arg("--")
        .arg(src)
        .arg(dst)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .status()
        .await
        .context("spawn cp")?;
    if status.success() {
        return Ok(());
    }
    // `cp` not available or failed; do a plain copy.
    tracing::debug!("cp --reflink failed (status {:?}); falling back to tokio::fs::copy", status);
    tokio::fs::copy(src, dst).await?;
    Ok(())
}

async fn launch_fc(
    cfg: &Config,
    id: Uuid,
    api_sock: &Path,
    log_path: &Path,
) -> Result<Child> {
    let stdout_file = std::fs::File::create(log_path)
        .with_context(|| format!("create log {:?}", log_path))?;
    let stderr_file = stdout_file.try_clone().context("dup log fd")?;

    let mut cmd = Command::new(&cfg.firecracker_bin);
    cmd.arg("--api-sock")
        .arg(api_sock)
        .arg("--id")
        .arg(id.to_string())
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::from(stdout_file))
        .stderr(std::process::Stdio::from(stderr_file));

    cmd.spawn().context("spawn firecracker")
}
