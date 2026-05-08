import type { Sandbox, SandboxProvider } from "./types";
import { E2BProvider } from "./e2b";
import { MicroVmProvider } from "./microvm";

export type { Sandbox, SandboxProvider, ExecResult, ExecOpts } from "./types";

const IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const SANDBOX_TIMEOUT_MS = 30 * 60 * 1000;

let sandboxPromise: Promise<Sandbox> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function getProvider(): SandboxProvider {
  const backend = (process.env.SANDBOX_BACKEND ?? "").toLowerCase();
  const url = process.env.SANDBOX_URL;

  if (backend === "microvm" || (backend === "" && url)) {
    if (!url) throw new Error("SANDBOX_URL not set (microvm backend)");
    return new MicroVmProvider({
      baseUrl: url,
      authToken: process.env.SANDBOX_TOKEN,
    });
  }

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

function isSandboxGone(e: unknown): boolean {
  if ((e as { isSandboxGone?: boolean })?.isSandboxGone) return true;
  const msg = String((e as Error)?.message ?? e).toLowerCase();
  return (
    msg.includes("sandbox was not found") ||
    msg.includes("sandbox not found") ||
    msg.includes("vm_gone") ||
    msg.includes("not_found") ||
    (msg.includes("sandbox") && msg.includes("timeout"))
  );
}

async function ensureSandbox(): Promise<Sandbox> {
  if (!sandboxPromise) {
    sandboxPromise = getProvider()
      .create(SANDBOX_TIMEOUT_MS)
      .catch((e) => {
        sandboxPromise = null;
        throw e;
      });
  }
  scheduleIdleKill();
  const sb = await sandboxPromise;
  try {
    await sb.setTimeout(SANDBOX_TIMEOUT_MS);
  } catch (e) {
    if (isSandboxGone(e)) {
      sandboxPromise = null;
      return ensureSandbox();
    }
    throw e;
  }
  return sb;
}

export async function getSandbox(): Promise<Sandbox> {
  return ensureSandbox();
}

export async function executeSandbox<T>(
  fn: (sb: Sandbox) => Promise<T>,
): Promise<T> {
  try {
    const sb = await ensureSandbox();
    return await fn(sb);
  } catch (e) {
    if (!isSandboxGone(e)) throw e;
    sandboxPromise = null;
    const sb = await ensureSandbox();
    return fn(sb);
  }
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
