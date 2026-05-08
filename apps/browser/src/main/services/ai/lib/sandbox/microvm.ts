import type { ExecOpts, ExecResult, Sandbox, SandboxProvider } from "./types";

interface MicroVmOpts {
  baseUrl: string;
  authToken?: string;
  defaultTimeoutMs?: number;
}

export class MicroVmProvider implements SandboxProvider {
  constructor(private readonly opts: MicroVmOpts) {}

  async create(timeoutMs?: number): Promise<Sandbox> {
    const res = await fetchJson<{ id: string }>(
      this.opts,
      "POST",
      "/sandbox",
      { timeout_ms: timeoutMs },
    );
    return new MicroVmSandbox(this.opts, res.id);
  }
}

class MicroVmSandbox implements Sandbox {
  constructor(
    private readonly opts: MicroVmOpts,
    private readonly id: string,
  ) {}

  async runPython(code: string, opts?: ExecOpts): Promise<ExecResult> {
    return await this.exec("python", code, opts);
  }

  async runBash(cmd: string, opts?: ExecOpts): Promise<ExecResult> {
    return await this.exec("bash", cmd, opts);
  }

  async readFile(path: string): Promise<Uint8Array> {
    const r = await fetchJson<{ data_b64: string; bytes: number }>(
      this.opts,
      "GET",
      `/sandbox/${this.id}/file?path=${encodeURIComponent(path)}`,
    );
    const buf = Buffer.from(r.data_b64, "base64");
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    const bytes =
      typeof data === "string"
        ? Buffer.from(data, "utf8")
        : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const data_b64 = bytes.toString("base64");
    await fetchJson<unknown>(this.opts, "PUT", `/sandbox/${this.id}/file`, {
      path,
      data_b64,
    });
  }

  async setTimeout(ms: number): Promise<void> {
    await fetchJson<unknown>(
      this.opts,
      "POST",
      `/sandbox/${this.id}/timeout`,
      { timeout_ms: ms },
    );
  }

  async kill(): Promise<void> {
    await fetchVoid(this.opts, "DELETE", `/sandbox/${this.id}`);
  }

  private async exec(
    lang: "python" | "bash",
    code: string,
    opts?: ExecOpts,
  ): Promise<ExecResult> {
    const timeout_ms = opts?.timeoutMs ?? this.opts.defaultTimeoutMs ?? 30_000;
    const r = await fetchJson<{
      stdout: string;
      stderr: string;
      exit_code: number;
    }>(this.opts, "POST", `/sandbox/${this.id}/exec`, {
      lang,
      code,
      timeout_ms,
    });
    return { stdout: r.stdout, stderr: r.stderr, exitCode: r.exit_code };
  }
}

async function fetchJson<T>(
  opts: MicroVmOpts,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await doFetch(opts, method, path, body);
  if (!res.ok) throw await toError(res, method, path);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

async function fetchVoid(
  opts: MicroVmOpts,
  method: string,
  path: string,
  body?: unknown,
): Promise<void> {
  const res = await doFetch(opts, method, path, body);
  if (!res.ok) throw await toError(res, method, path);
}

async function doFetch(
  opts: MicroVmOpts,
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const url = `${opts.baseUrl.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.authToken) headers["Authorization"] = `Bearer ${opts.authToken}`;
  return await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function toError(
  res: Response,
  method: string,
  path: string,
): Promise<Error> {
  let detail = "";
  try {
    detail = await res.text();
  } catch {
    /* ignore */
  }
  const err = new Error(
    `microvm ${method} ${path} → ${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`,
  );
  if (res.status === 404 || res.status === 410) {
    (err as Error & { isSandboxGone?: boolean }).isSandboxGone = true;
  }
  return err;
}
