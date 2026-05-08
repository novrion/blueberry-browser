# Blueberry Browser — Architecture Plan

## Goal

Add an AI agent layer to Blueberry that can act on web pages, run code, analyze files, and persist conversations across devices — for non-technical users with zero install friction.

---

## Current State

Blueberry today is a pure Electron desktop app:

- React 19 + TypeScript + Tailwind UI (sidebar, topbar, tabs)
- Main process orchestrates browser tabs (`src/main/Tab.ts`), LLM client (`src/main/LLMClient.ts`), IPC (`src/main/EventManager.ts`)
- LLM via Vercel AI SDK streaming directly from main process to OpenAI/Anthropic
- API key stored in user's local `.env`
- No backend, no DB, no auth, no file upload, no tool calling

### Inherent Limitations of Local-Only

1. **No cross-device persistence.** Chat history and any agent state live in the user's machine. Switching from desktop to phone/web loses everything.
2. **API keys exposed to client.** `.env` on user's disk is fine for a developer prototype but unworkable for a consumer product. Cannot ship a publicly distributed app where each user must paste an OpenAI key.
3. **No multi-user identity.** No way to gate features, enforce quotas, do account-based billing, or sync across sessions.
4. **No collaboration / sharing.** Cannot share a chat or scripted agent with another user.
5. **Compute ceiling = user's laptop.** Heavy file analysis (large CSVs, video, ML inference) blocks the UI or fails on weak machines.
6. **Sandbox dilemma.** Running LLM-generated code locally requires either:
   - Bundling a large WASM runtime (Pyodide ~30MB, WebVM ~100MB) → install bloat
   - Native sandbox (`isolated-vm`, Docker) → install friction, native compile, breaks "zero barrier"
   - Doing nothing → no real agent capability
7. **No multi-language execution.** Tab JS only. No Python, no shell, no `pandas` for Excel, no `ffmpeg` for media.
8. **No backend-mediated integrations.** OAuth flows for Gmail/Drive/etc. need a server-registered redirect URI. Pure Electron makes this awkward.
9. **No usage telemetry / abuse prevention.** Cannot rate-limit, cannot detect prompt injection patterns at scale, cannot cut off bad actors.
10. **Updates only ship through full app re-release.** Tool definitions, prompt templates, and agent logic cannot be hot-updated without an Electron update.

---

## Architectural Decision

Move from "pure local desktop" to **thin client + cloud backend hybrid**, with a strict split:

- **Client-local (Electron):** anything that needs the user's logged-in browser session — DOM manipulation, page scraping behind auth walls, screenshots, cookies, navigation.
- **Cloud (your backend):** identity, chat history, file storage, code execution sandbox, LLM proxying.

Rationale:

- The LLM already calls a cloud API. A backend doesn't add a new privacy boundary; it formalizes the existing one.
- Cross-device persistence requires a server. Once you have one, colocating compute and storage there is free.
- Non-technical users cannot install Docker, won't tolerate a 100MB WASM runtime download, and can't paste API keys.
- Server-side microVMs (E2B) give true `bash` + Python + binaries with zero client install, identical behavior on Mac/Win/Linux.
- Tab actions must stay client-side regardless — auth cookies live on the user's machine.

---

## Target Architecture

```
┌────────────────────────────────────────────────────────────┐
│  Electron Client (existing repo, refactored)              │
│  ──────────────────────────────────────────────────────   │
│  • Tabs + DOM actions (Tab.executeJavaScript)             │
│  • Sidebar chat UI (React)                                │
│  • File picker + upload progress                          │
│  • Screenshot + page text capture                         │
│  • Auth token (Clerk/Supabase) in safeStorage             │
└──────────────────┬─────────────────────────────────────────┘
                   │ HTTPS + WebSocket (auth: Bearer token)
                   ▼
┌────────────────────────────────────────────────────────────┐
│  Backend API (Hono on Cloudflare Workers OR Fly.io)       │
│  ──────────────────────────────────────────────────────   │
│  • Auth middleware                                        │
│  • LLM proxy (server holds API keys)                      │
│  • Chat CRUD                                              │
│  • File upload signing (presigned PUT to R2)              │
│  • Sandbox session broker                                 │
│  • Tool-call router (tab_action streamed back to client)  │
└────┬──────────────┬──────────────┬───────────────────────┘
     │              │              │
     ▼              ▼              ▼
┌─────────┐   ┌──────────┐   ┌────────────────────┐
│Postgres │   │ R2/S3    │   │ E2B Sandbox        │
│(Supabase│   │ buckets  │   │ (Firecracker VM)   │
│ /Neon)  │   │          │   │                    │
│         │   │ user/    │   │ /work mounts user  │
│ chats   │   │ {uid}/   │   │  bucket prefix     │
│ messages│   │ files/   │   │                    │
│ files   │   │ artifacts│   │ bash, python,      │
│ users   │   │          │   │ pandas, ffmpeg     │
└─────────┘   └──────────┘   └────────────────────┘
                   ▲
                   └── direct mount via s3fs / signed URLs
```

### Component Choices

| Layer | Pick | Reason |
|-------|------|--------|
| Auth | Clerk | Easiest, free <10k MAU, OAuth providers built-in |
| Backend runtime | Hono on Cloudflare Workers | Cheap, edge-fast, scales to zero |
| Database | Supabase Postgres | Free tier, generous limits, SQL |
| Object store | Cloudflare R2 | Zero egress fees, S3-compatible |
| Sandbox | E2B Pro | Real Linux microVM, ~150ms boot, persistent FS, $150/mo + usage |
| LLM | Anthropic + OpenAI via Vercel AI SDK (existing) | Keep current code path, move keys server-side |
| Client transport | WebSocket for streaming | Tool-call streaming requires bidirectional |

### Tool Surface for the Agent

| Tool | Runs where | Purpose |
|------|-----------|---------|
| `tab_action(js)` | Client (Electron) | DOM manipulation, scraping, form fill, cookies |
| `tab_screenshot()` | Client | Page screenshot |
| `tab_navigate(url)` | Client | Open new URL |
| `bash(cmd)` | Sandbox (E2B) | Shell commands with `/work` mounted |
| `python(code)` | Sandbox (E2B) | Python with pandas, openpyxl, etc. |
| `read_file(path)` | Sandbox + bucket | Read user-attached or generated file |
| `write_file(path, data)` | Sandbox + bucket | Persist artifact to user's bucket |
| `notify_user(msg)` | Backend → client | Mid-task progress message in chat |
| `use_mcp(server, tool, args)` | Backend | Bridge to MCP servers (Linear, Drive, Slack) |

### Cross-Device State Model

| Data | Location | Synced |
|------|----------|--------|
| Chat history | Postgres | Yes |
| File uploads | R2 | Yes |
| Generated artifacts | R2 | Yes |
| Sandbox process state | Ephemeral E2B | No, recreated on resume |
| Tab cookies / sessions | Local Electron only | No (security) |
| Browser history | Postgres (optional) | Optional, opt-in |

Sandbox is **stateless compute**, bucket is **state**. Reopen chat on another device → spawn fresh sandbox → mount same bucket prefix → continue.

---

## Implementation Plan

### Phase 0 — Backend Skeleton

- [ ] Create `apps/api` (or separate repo) with Hono + Cloudflare Workers
- [ ] Set up Clerk app, get publishable + secret keys
- [ ] Create Supabase project, run migrations: `users`, `chats`, `messages`, `files`
- [ ] Create R2 bucket `blueberry-files`
- [ ] Add E2B account, store `E2B_API_KEY` as Worker secret
- [ ] Add OpenAI + Anthropic keys as Worker secrets

### Phase 1 — Move LLM Client to Backend

- [ ] Port `src/main/LLMClient.ts` logic to `apps/api/src/llm.ts`
- [ ] Replace direct `streamText` calls in Electron with WebSocket to backend
- [ ] Client sends `{message, chatId, attachments[]}`, backend streams chunks back
- [ ] Remove `.env` API-key requirement from Electron build
- [ ] Add Clerk Electron auth flow: open browser → callback to `app://blueberry/auth` → store token in `safeStorage`

### Phase 2 — File Upload + Storage

- [ ] Sidebar: drag-drop file zone, file list per chat
- [ ] Client requests presigned PUT URL from backend → uploads direct to R2
- [ ] Backend writes `files` row: `{user_id, chat_id, key, name, size, mime}`
- [ ] LLM context gets `[Attached files: data.xlsx (200KB), photo.png (1.2MB)]`
- [ ] Client shows upload progress; user can remove before sending

### Phase 3 — Sandbox Integration

- [ ] Backend: `SandboxManager` keyed by `chatId`, lazy-creates E2B sandbox on first tool call
- [ ] On creation: mount user's R2 prefix at `/work` (use `s3fs-fuse` inside sandbox or sync-on-demand)
- [ ] Implement tools: `bash`, `python`, `read_file`, `write_file`
- [ ] Stream stdout/stderr to client via WebSocket as agent runs
- [ ] Idle sandbox killed after 10 min; resumed on next message
- [ ] Add timeout (default 30s) and OOM caps per tool call

### Phase 4 — Tool Calling + Tab Actions

- [ ] Wire Vercel AI SDK `tools` parameter on backend
- [ ] For client-side tools (`tab_action`, `tab_screenshot`): backend emits tool-call to client, awaits result over WebSocket, feeds result back into LLM loop
- [ ] Implement `notify_user` as direct WebSocket push to chat UI
- [ ] Add tool-call rendering in sidebar (collapsible cards showing tool, args, result)

### Phase 5 — MCP Bridge

- [ ] Backend reads per-user MCP server config (Postgres `mcp_servers` table)
- [ ] On chat start: discover tools from each configured MCP server
- [ ] Expose as `use_mcp(server, tool, args)` to LLM, OR inline each MCP tool as first-class
- [ ] Settings UI in sidebar to add/remove MCP servers

### Phase 6 — Polish

- [ ] Rate limiting per user (Cloudflare KV counter)
- [ ] Cost guards (max sandbox-seconds/day per user)
- [ ] Sandbox warm pool to cut cold-start latency
- [ ] Error surfaces: sandbox crashed, file too large, upload failed, etc.
- [ ] Telemetry: PostHog or similar, opt-in

---

## Cost Model (rough)

Assumptions: 100 daily-active users, 10 min sandbox use/day each, 500MB avg file storage.

| Item | Monthly |
|------|---------|
| E2B compute (1 vCPU, 1 GiB) | ~$33 |
| E2B Pro plan fee | $150 |
| R2 storage (50 GB) | ~$0.75 |
| R2 egress | $0 |
| Cloudflare Workers | ~$5 |
| Supabase | $0 (free tier) |
| Clerk | $0 (free tier) |
| LLM (varies wildly) | $50-500 |
| **Total** | **~$240-700** |

At 10k users: ~$5-7k/mo. Break-even point to migrate sandbox to self-hosted Firecracker farm.

---

## Migration Path Beyond MVP

1. **Self-host sandbox.** Replace E2B with Firecracker on Hetzner bare metal once compute spend > $2k/mo. Estimated saving: 60-70%. Engineering cost: 2-4 weeks.
2. **Edge-cache static parts.** Tool definitions, system prompts → KV.
3. **Per-region buckets.** Reduce file-mount latency for global users.
4. **Optional local-only mode.** For privacy-sensitive users, keep an offline path using Pyodide for Python-only file analysis. Worth it only if user demand exists.

---

## Open Questions

- Auth UX: how to handle Clerk OAuth in Electron without spawning external browser? (Probably custom protocol handler `blueberry://auth`.)
- Tab-action tool-call latency: backend → client → backend roundtrip per call. Acceptable for agentic loops? Mitigate with batch tool API.
- File mount strategy: `s3fs-fuse` inside sandbox vs. backend-side download to sandbox tmp. First is cleaner, second is simpler. Start with second, migrate if perf warrants.
- MCP auth: per-user OAuth tokens for each MCP server. Storage: Postgres encrypted column or separate KMS-backed vault.
- Compliance: if users upload PII/PHI, need DPA with E2B/Cloudflare/Supabase. Defer until needed.

---

## Summary

Current Blueberry = local-only Electron app, fine as a prototype, blocked from becoming a consumer product by the limitations above.

Decision: **thin client + cloud backend.** Tab actions stay local because cookies. Everything else (chat persistence, files, code execution) moves to a small backend with E2B handling sandboxed compute. No client install beyond the Electron app itself. Cross-platform, cross-device, multi-language code execution unlocked. Migration to self-hosted infra deferred until scale forces it.
