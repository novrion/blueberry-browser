# Bluberry Coding Challenge

### Objective
- AI has code execution sandbox


### Solution
- E2B + custom self-hosted MicroVM sandbox
    - exposed via tools in a ToolLoopAgent (Vercel AI SDK)
        - python (run python script)
        - bash (run bash cmds)
        - read_file
        - write_file
    - Either E2B is chosen, or MicroVM is
    - custom FireCracker (FC) MicroVM had significantly faster boot time with 'warm up'
        (let a few idle VMs run on standby and await claim -> ~1ms 'boot')
        - on my machine boot is otherwise ~300ms (poor config, and no snaphotting which E2B uses)
            (so we can likely get E2B speeds normally too)
- Browser tools
    - manipulate dom
    - get page (HTML, text, or image)
    - navigate (navigate page)

### Sandbox Rationale
Blueberry has no persistence and is completely local but a real agentic browser like Strawberry would have cloud infra  
=> chats and their files are already stored in the cloud => no gain from running sandbox on local machine.  
Also, there is no native-performance cross-platform local VM without barriers to installation (like requiring docker desktop)  
=> so the solution is to have a cloud-hosted linux machine that handles the cross-platform issue.  
=> adds network latency but is well worth it. If the agentic browser supported files in the GiB-range and required higher compute it would be nice with local compute, but there are major cross-platform issues and containerization issues. Better to abstract the sandbox as a network interface on the client-side instead.

**E2B**: Easy out-of-the-box industry-standard cloud-hosted code execution sandbox
**FC MicroVM**: MVP has slower raw speeds but with some 'warming' ('idling'), it is WAY faster than E2B
    + cheaper (cloud compute vs paying E2B 'service tax')
    + more configurable to specific needs
    + faster (also due to can have better network locality (closer to consumers i.e. server in Stockholm instead of being bottlenecked by E2B servers))
    - more infra to handle


### Achieved
- agent that can navigate pages, fill forms for you, research, and execute code in a sandbox to analyze data etc.


### Issues
- MicroVM is still just an MVP.
    - agent guest has no network so cannot install stuff (maybe this is okay though).
    - It does not have Jailer to ensure no agents can leak out of the VM.
    - No parameters are optimized.
    - No snapshotting...

- No cloud-infra
    - MVP for this challenge ignored all auth, cloud-infra etc... purely localhost

- codebase maintainability note:
    - not very clean right now
    - never made electron app before so unsure of best file structure etc.


### TODO (if I were to continue)
- optimize MicroVM solution crazy (I LOVE RUST <3 and (hopefully) diffing cloud providers)
- all the cloud-infra stuff like handling file persistence, auth, db, buckets, MicroVM auth, MicroVM networking, and handling how best to load chat-files into MicroVM (let AI do it? auto-load on chat open?)
- codebase standards are inconsistent. I have never built an electron app before so unsure how best to structure files. So a maintainability cleanup would be necessary here.


### Repo Layout

```
blueberry-browser/
├── apps/
│   └── browser/                          # Electron app (TypeScript)
│       └── src/
│           ├── main/                     # main process
│           │   ├── ipc/                  # IPC event bus (renderer <-> main)
│           │   ├── windows/              # BrowserWindow / Tab / SideBar / TopBar wiring
│           │   └── services/
│           │       ├── LLMClient.ts      # provider client + chat session
│           │       └── ai/
│           │           ├── run.ts        # ToolLoopAgent run loop
│           │           ├── agents/       # agent factories (browser agent)
│           │           ├── instructions/ # system prompts + tool-context injection
│           │           ├── tools/
│           │           │   ├── browser/  # get-page, modify-dom, navigate
│           │           │   └── sandbox/  # python, bash, read-file, write-file
│           │           └── lib/sandbox/  # backend impls: e2b.ts, microvm.ts (HTTP client)
│           ├── preload/                  # Electron preload (contextBridge)
│           └── renderer/                 # React UIs: sidebar (chat), topbar (tabs)
│
└── services/
    └── sandbox/                          # self-hosted MicroVM sandbox (Rust workspace)
        ├── orchestrator/                 # host HTTP server (axum)
        │   └── src/
        │       ├── main.rs               # entry, signal handling, warmup
        │       ├── config.rs             # SANDBOX_* env -> Config
        │       ├── routes.rs             # /sandbox + /exec + /file routes
        │       ├── registry.rs           # active VM map + warm pool + idle reaper
        │       ├── vm.rs                 # Vm: exec/read/write over vsock
        │       ├── vsock.rs              # host-side vsock client
        │       └── fc/                   # Firecracker process + management API
        ├── guest-agent/                  # PID-1 agent inside each VM (musl static)
        ├── proto/                        # shared wire types (Request/Response)
        ├── scripts/
        │   ├── build-rootfs.sh           # alpine + agent + python deps -> ext4
        │   ├── fetch-kernel.sh           # download known-good vmlinux
        │   └── bench-spinup.py           # boot-latency benchmark vs e2b
        ├── Dockerfile
        └── docker-compose.yml
```
