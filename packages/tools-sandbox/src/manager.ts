import type { Sandbox, SandboxProvider } from "./sandbox";

interface Entry {
  sandbox: Promise<Sandbox>;
  lastUsed: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export interface SandboxManagerOpts {
  provider: SandboxProvider;
  idleTimeoutMs?: number;
}

export class SandboxManager {
  private entries = new Map<string, Entry>();
  private idleTimeoutMs: number;

  constructor(private opts: SandboxManagerOpts) {
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 10 * 60 * 1000;
  }

  async getOrCreate(sessionId: string): Promise<Sandbox> {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      const sandbox = this.opts.provider.create(sessionId);
      entry = { sandbox, lastUsed: Date.now(), idleTimer: null };
      this.entries.set(sessionId, entry);
    }
    this.touch(sessionId);
    return entry.sandbox;
  }

  touch(sessionId: string): void {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    entry.lastUsed = Date.now();
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      this.kill(sessionId).catch((e) =>
        console.error("[SandboxManager] idle kill failed:", e),
      );
    }, this.idleTimeoutMs);
  }

  async kill(sessionId: string): Promise<void> {
    const entry = this.entries.get(sessionId);
    if (!entry) return;
    this.entries.delete(sessionId);
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    try {
      const sb = await entry.sandbox;
      await sb.kill();
    } catch (e) {
      console.error("[SandboxManager] kill failed:", e);
    }
  }

  async killAll(): Promise<void> {
    const ids = Array.from(this.entries.keys());
    await Promise.allSettled(ids.map((id) => this.kill(id)));
  }
}
