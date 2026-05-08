use std::path::PathBuf;
use std::time::Duration;

use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub bind_addr: String,
    pub work_dir: PathBuf,
    pub firecracker_bin: PathBuf,
    pub kernel_path: PathBuf,
    pub rootfs_path: PathBuf,
    pub boot_args: String,

    pub vm_mem_mib: u32,
    pub vm_vcpus: u8,
    pub max_vms: usize,
    pub default_timeout: Duration,
    pub max_timeout: Duration,
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.is_empty())
}
fn env_or(key: &str, default: &str) -> String {
    env(key).unwrap_or_else(|| default.into())
}
fn env_u64(key: &str, default: u64) -> u64 {
    env(key).and_then(|v| v.parse().ok()).unwrap_or(default)
}
fn env_path(key: &str, default: &str) -> PathBuf {
    PathBuf::from(env_or(key, default))
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let work_dir = env_path("SANDBOX_WORK_DIR", "/var/lib/sandbox");
        std::fs::create_dir_all(&work_dir).with_context(|| format!("mkdir {:?}", work_dir))?;

        Ok(Self {
            bind_addr: env_or("SANDBOX_BIND", "0.0.0.0:8080"),
            work_dir,
            firecracker_bin: env_path("SANDBOX_FC_BIN", "/usr/local/bin/firecracker"),
            kernel_path: env_path("SANDBOX_KERNEL", "/opt/sandbox/vmlinux"),
            rootfs_path: env_path("SANDBOX_ROOTFS", "/opt/sandbox/rootfs.ext4"),
            boot_args: env_or(
                "SANDBOX_BOOT_ARGS",
                "console=ttyS0 reboot=k panic=1 pci=off random.trust_cpu=on quiet",
            ),
            vm_mem_mib: env_u64("SANDBOX_VM_MEM_MIB", 512) as u32,
            vm_vcpus: env_u64("SANDBOX_VM_VCPUS", 1) as u8,
            max_vms: env_u64("SANDBOX_MAX_VMS", 32) as usize,
            default_timeout: Duration::from_secs(env_u64("SANDBOX_DEFAULT_TIMEOUT_S", 30)),
            max_timeout: Duration::from_secs(env_u64("SANDBOX_MAX_TIMEOUT_S", 600)),
        })
    }
}
