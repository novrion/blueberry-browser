# sandbox

A self-hosted code execution sandbox. Replaces e2b. Each "sandbox" is a
fresh Firecracker MicroVM; an in-VM agent receives JSON-RPC over vsock,
runs code, returns results. The orchestrator exposes an HTTP API the
Electron app calls.

```
┌──────────────┐   HTTP   ┌──────────────────────┐  vsock UDS  ┌─────────────┐
│ Electron app │  ──────► │ orchestrator (Rust)  │ ──────────► │ guest agent │
│ (microvm.ts) │  ◄────── │  axum + firecracker  │ ◄────────── │  in MicroVM │
└──────────────┘          └──────────────────────┘             └─────────────┘
```

## Why MicroVMs (not containers)

- **Hardware isolation**: each sandbox runs in its own KVM-backed VM.
  Container escapes (kernel CVEs, namespace bugs) don't apply.
- **Fast startup**: Firecracker boots a minimal kernel + agent in
  ~300 ms cold. No full distro init, no Docker engine.
- **Resource caps**: vcpu + memory set per VM via FC's machine-config.
- **Fine control**: we own the kernel, rootfs, init. Reproducible.

## Repo layout

```
services/sandbox
├── Cargo.toml                # workspace manifest
├── proto/                    # shared wire protocol crate
│   └── src/lib.rs            #   Request/Response enums + framing
├── orchestrator/             # host-side HTTP service
│   └── src/
│       ├── main.rs           # entry, signal handling
│       ├── config.rs         # SANDBOX_* env vars → typed Config
│       ├── error.rs          # ApiError → HTTP response
│       ├── routes.rs         # axum routes
│       ├── vsock.rs          # host-initiated vsock client
│       ├── vm.rs             # high-level Vm: exec/read/write/touch
│       ├── registry.rs       # active VM map + idle reaper
│       └── fc/
│           ├── api.rs        # tiny HTTP-over-UDS client to the FC API
│           └── instance.rs   # FC process spawn + configure + start
├── guest-agent/              # PID-1 agent inside the VM (musl static)
│   └── src/main.rs
├── scripts/
│   ├── fetch-kernel.sh       # download a known-good vmlinux
│   └── build-rootfs.sh       # alpine + agent → ext4
├── Dockerfile
├── docker-compose.yml
└── README.md                 # this file
```

The workspace is three crates because the host binary and the in-VM
binary compile to different targets:

| Crate         | Target                            | Role                   |
|---------------|-----------------------------------|------------------------|
| `proto`       | both                              | shared types + framing |
| `orchestrator`| `x86_64-unknown-linux-gnu` (host) | HTTP server            |
| `guest-agent` | `x86_64-unknown-linux-musl` (VM)  | static init binary     |

## How it works (top-down)

### 1. Startup

`main.rs` reads env into a `Config`, builds an `Arc<Registry>`, spawns
an idle reaper task, then serves the axum router until SIGINT/SIGTERM.

### 2. Creating a sandbox

`POST /sandbox` lands in `routes::create_sandbox` → `Registry::create`:

1. Cap check (`SANDBOX_MAX_VMS`).
2. `fc::boot(cfg, uuid)` — see step 3.
3. Wrap the resulting `FcInstance` in a `Vm` with an idle deadline.
4. Insert into the registry's `HashMap<Uuid, Arc<Vm>>`.
5. Return `{ id }`.

### 3. Booting a Firecracker VM

`fc::instance::boot` performs:

1. `mkdir <work_dir>/<uuid>/` — per-VM scratch dir.
2. `cp --reflink=auto rootfs.ext4 <root>/rootfs-overlay.ext4` —
   copy-on-write where the filesystem supports it (btrfs, xfs+reflink,
   zfs, bcachefs); falls back to a full copy on ext4. Each VM writes
   to its own overlay so VMs can't see each other.
3. Spawn the FC process:
   ```
   firecracker --api-sock <root>/fc-api.sock --id <uuid>
   ```
   stdout/stderr → `<root>/fc.log`. `kill_on_drop(true)` so a panic
   in the orchestrator can't leak FC processes.
4. Poll for the API socket file to appear (~50–500 ms).
5. Send five `PUT`s to FC's management API over the UDS:
   - `/boot-source` — kernel image + boot args
   - `/drives/rootfs` — overlay path, read-write
   - `/machine-config` — vcpu count + memory MiB
   - `/vsock` — guest CID 3 + host UDS path
   - `/actions {InstanceStart}` — actually boot
6. `VsockClient::wait_ready(15s)` — open the vsock UDS and ping the
   agent until it responds, with exponential backoff.

If any step fails, the spawned `Child` is dropped, FC dies, and the
caller sees a clean error.

### 4. Inside the VM

The kernel boots → runs `/sbin/init` (a tiny shell script in the
rootfs) → mounts proc/sys/dev → execs `/usr/local/bin/sandbox-agent`.

The agent binds an AF_VSOCK listener on port 1234 inside the VM,
accepts connections one at a time, spawns a Tokio task per connection,
reads one length-prefixed JSON request, dispatches it, writes one
response, closes the connection. Operations:

| Request               | Action |
|-----------------------|--------|
| `Ping`                | reply `Pong` |
| `Exec {python, code}` | `python3 -u -c '<code>'`, capture stdout/stderr/exit |
| `Exec {bash, code}`   | `/bin/sh -c '<code>'`, same capture |
| `ReadFile {path}`     | read file, base64-encode, return |
| `WriteFile {path,b64}`| decode, mkdir parents if needed, write |

Exec is wrapped in `tokio::time::timeout`; on expiry the child is
killed via `kill_on_drop` and we return exit code 124.

### 5. Host-side vsock client

Firecracker's vsock device exposes a Unix Domain Socket on the host.
Connecting to it speaks a tiny "host-initiated" protocol:

1. Open `UnixStream` to `<root>/agent.vsock`.
2. Write `"CONNECT 1234\n"` (the guest port we want).
3. Read a line; it should start with `"OK "`.
4. Now bytes flow bidirectionally to the guest agent on port 1234.

The orchestrator does this for every request — connections are
short-lived, one RPC per connection. That keeps the protocol stateless
and lets multiple operations on the same VM run in parallel without
locking.

`vm::Vm::exec` / `read_file` / `write_file` wrap the vsock call in
`tokio::time::timeout` so a misbehaving guest never hangs a request.

### 6. Idle reaping

`Registry::spawn_idle_reaper` runs a background task every 10 s. It
collects every `Uuid` whose `Vm::deadline()` has passed, removes them
from the map, and calls `Vm::shutdown()` (kill FC, remove the per-VM
dir).

Each successful operation calls `Vm::touch(60s)` to extend the
deadline, so an actively-used VM never gets reaped. Clients can also
push the deadline forward explicitly via
`POST /sandbox/:id/timeout {timeout_ms}`.

## Wire protocol

Defined in `proto/src/lib.rs`. Both host and guest depend on this
crate so they speak the same format.

Each frame on the vsock connection is:

```
[4 bytes: BE u32 length] [N bytes: JSON]
```

JSON shape (tagged):

```json
{ "kind": "exec", "lang": "python", "code": "print(1+1)", "timeout_ms": 30000 }
{ "kind": "exec_result", "stdout": "2\n", "stderr": "", "exit_code": 0 }

{ "kind": "read_file", "path": "/work/data.csv" }
{ "kind": "file_data", "data_b64": "...", "bytes": 12345 }

{ "kind": "write_file", "path": "/work/in.xlsx", "data_b64": "..." }
{ "kind": "ok" }

{ "kind": "ping" }
{ "kind": "pong" }

{ "kind": "err", "message": "..." }
```

Max frame size is 64 MiB (`MAX_FRAME_BYTES`). Files larger than that
must be chunked or copied differently.

## HTTP API

| Method | Path                       | Body                                            | Returns |
|--------|----------------------------|-------------------------------------------------|---------|
| GET    | `/health`                  | —                                               | `{ok}` |
| POST   | `/sandbox`                 | `{timeout_ms?}`                                 | `{id}` |
| DELETE | `/sandbox/:id`             | —                                               | 204 |
| POST   | `/sandbox/:id/exec`        | `{lang:"python"\|"bash", code, timeout_ms?}`    | `{stdout, stderr, exit_code}` |
| GET    | `/sandbox/:id/file?path=…` | —                                               | `{path, bytes, data_b64}` |
| PUT    | `/sandbox/:id/file`        | `{path, data_b64}`                              | 204 |
| POST   | `/sandbox/:id/timeout`     | `{timeout_ms}`                                  | 204 |

The HTTP layer is unauthenticated. Bind to localhost or front it with
a reverse proxy / token-checking middleware before exposing.

## Configuration

| Env var                      | Default                          |
|------------------------------|----------------------------------|
| `SANDBOX_BIND`               | `0.0.0.0:8080`                   |
| `SANDBOX_KERNEL`             | `/opt/sandbox/vmlinux`           |
| `SANDBOX_ROOTFS`             | `/opt/sandbox/rootfs.ext4`       |
| `SANDBOX_FC_BIN`             | `/usr/local/bin/firecracker`     |
| `SANDBOX_WORK_DIR`           | `/var/lib/sandbox`               |
| `SANDBOX_BOOT_ARGS`          | `console=ttyS0 reboot=k …`       |
| `SANDBOX_VM_MEM_MIB`         | `512`                            |
| `SANDBOX_VM_VCPUS`           | `1`                              |
| `SANDBOX_MAX_VMS`            | `32`                             |
| `SANDBOX_DEFAULT_TIMEOUT_S`  | `30`                             |
| `SANDBOX_MAX_TIMEOUT_S`      | `600`                            |

## Build and run

### Requirements

- Linux host with `/dev/kvm` (no nested-virt clouds; bare metal or
  `*.metal` instances).
- Docker + docker compose (or `cargo` directly).
- `bash`, `curl`, `sudo`, `mkfs.ext4` for the rootfs script.

### Build kernel and rootfs

From `services/sandbox/`:

```bash
./scripts/fetch-kernel.sh           # → assets/vmlinux
./scripts/build-rootfs.sh           # → assets/rootfs.ext4
```

The rootfs script cross-builds the guest agent for
`x86_64-unknown-linux-musl` inside the official `rust:alpine` image,
extracts an Alpine 3.20 rootfs, drops the agent at
`/usr/local/bin/sandbox-agent`, writes a small `/sbin/init`, and packs
the result as an ext4 image via loop mount.

### Run with Docker

```bash
docker compose up --build
curl http://localhost:8080/health   # {"ok":true}
```

### Run on the host (no Docker)

```bash
SANDBOX_KERNEL=$PWD/assets/vmlinux \
SANDBOX_ROOTFS=$PWD/assets/rootfs.ext4 \
SANDBOX_WORK_DIR=/tmp/sandbox-work \
RUST_LOG=info \
cargo run --release -p sandbox-orchestrator
```

### Wiring to the Electron app

In `apps/browser/.env`:

```
SANDBOX_URL=http://localhost:8080
```

The provider selector in
`apps/browser/src/main/services/ai/lib/sandbox/index.ts` picks
`MicroVmProvider` when `SANDBOX_URL` is set, otherwise falls back to
the e2b cloud provider.

## File transfer

The wire protocol supports arbitrary files via base64. The HTTP API
exposes both directions:

- `PUT /sandbox/:id/file  { path, data_b64 }` — write into the VM.
- `GET /sandbox/:id/file?path=…` — read out of the VM.

The Electron tool side
(`apps/browser/src/main/services/ai/tools/sandbox/{read-file,write-file}.ts`)
exposes this to the AI as `read_file` / `write_file` tools, with a
1 MB read cap and base64 support for binary content.

So **upload + execute pipelines work today**. Excel example:

1. UI attaches `report.xlsx`; the main process reads the bytes,
   base64-encodes them, calls `write_file` with `path=/work/report.xlsx`.
2. AI runs a `python` tool with code that does
   `import pandas as pd; df = pd.read_excel("/work/report.xlsx"); …`.
3. Results stream back as stdout in the exec response.

Caveats specific to the current rootfs:

- The default Alpine rootfs ships `python3` and `py3-pip` only.
  Pandas, numpy, openpyxl, etc. are not installed. The VM has **no
  network access** in the current configuration, so `pip install`
  inside the VM cannot reach PyPI.
- For pandas/Excel work today: bake the deps into `rootfs.ext4` at
  build time. Add to `scripts/build-rootfs.sh` inside the apk install
  block:
  ```
  py3-pandas py3-numpy py3-openpyxl py3-xlsxwriter
  ```
  These are in Alpine's community repo. Then rebuild the rootfs.
- Or, future work: enable a tap-based egress so guests can hit PyPI
  on demand. Keeping the VM offline for now is simpler and safer.

The 64 MiB frame size cap on the protocol bounds individual file
transfers. Larger artifacts need chunking; the current AI tools cap
reads at 1 MB regardless.

## Limitations / future work

- **No guest networking**. Vsock-only. Code that needs PyPI, apt, or
  external HTTP won't reach the network. Add tap + bridge if needed.
- **No jailer**. FC currently runs unsandboxed on the host (KVM still
  enforces VM isolation; this is about host-side privileges of the
  FC process itself). Add jailer chroot + cgroups for production.
- **No snapshot/warm pool**. Every sandbox cold-boots
  (~hundreds of ms). FC's snapshot/restore could drop that to tens
  of ms, but adds complexity.
- **Auth**. HTTP is open. Localhost-only is fine; external exposure
  needs a token check.
- **Single host**. No cross-host scheduling; one orchestrator per
  machine.
