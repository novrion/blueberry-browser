import { Sandbox as E2BSandbox } from "@e2b/code-interpreter";
import type { ExecOpts, ExecResult, Sandbox, SandboxProvider } from "./types";

export class E2BProvider implements SandboxProvider {
  constructor(private apiKey: string) {}

  async create(timeoutMs?: number): Promise<Sandbox> {
    const sb = await E2BSandbox.create({
      apiKey: this.apiKey,
      ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    });
    return new E2BSandboxAdapter(sb);
  }
}

class E2BSandboxAdapter implements Sandbox {
  constructor(private sb: E2BSandbox) {}

  async runPython(code: string, opts?: ExecOpts): Promise<ExecResult> {
    const res = await this.sb.runCode(code, {
      timeoutMs: opts?.timeoutMs ?? 30_000,
    });
    const stdout = res.logs.stdout.join("");
    const stderr = res.logs.stderr.join("");
    if (res.error) {
      return {
        stdout,
        stderr: `${stderr}${res.error.name}: ${res.error.value}\n${res.error.traceback ?? ""}`,
        exitCode: 1,
      };
    }
    return { stdout, stderr, exitCode: 0 };
  }

  async runBash(cmd: string, opts?: ExecOpts): Promise<ExecResult> {
    const res = await this.sb.commands.run(cmd, {
      timeoutMs: opts?.timeoutMs ?? 30_000,
    });
    return {
      stdout: res.stdout,
      stderr: res.stderr,
      exitCode: res.exitCode ?? 0,
    };
  }

  async readFile(path: string): Promise<Uint8Array> {
    return await this.sb.files.read(path, { format: "bytes" });
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    if (typeof data === "string") {
      await this.sb.files.write(path, data);
      return;
    }
    const ab = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    await this.sb.files.write(path, ab);
  }

  async setTimeout(ms: number): Promise<void> {
    await this.sb.setTimeout(ms);
  }

  async kill(): Promise<void> {
    await this.sb.kill();
  }
}
