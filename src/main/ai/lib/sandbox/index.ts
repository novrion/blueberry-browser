import type { Sandbox, SandboxProvider } from "./types";
import { E2BProvider } from "./e2b";

export type { Sandbox, SandboxProvider, ExecResult, ExecOpts } from "./types";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;

let sandboxPromise: Promise<Sandbox> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function getProvider(): SandboxProvider {
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) throw new Error("E2B_API_KEY not set");
  return new E2BProvider(apiKey);
}

function scheduleIdleKill(): void {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    shutdownSandbox().catch((e) =>
      console.error("[sandbox] idle kill failed:", e),
    );
  }, IDLE_TIMEOUT_MS);
}

export async function getSandbox(): Promise<Sandbox> {
  if (!sandboxPromise) sandboxPromise = getProvider().create();
  scheduleIdleKill();
  return sandboxPromise;
}

export async function executeSandbox<T>(
  fn: (sb: Sandbox) => Promise<T>,
): Promise<T> {
  const sb = await getSandbox();
  return fn(sb);
}

export async function shutdownSandbox(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  const p = sandboxPromise;
  sandboxPromise = null;
  if (!p) return;
  try {
    const sb = await p;
    await sb.kill();
  } catch (e) {
    console.error("[sandbox] kill failed:", e);
  }
}
