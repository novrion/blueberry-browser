import {
  Sandbox as E2BBaseSandbox,
  type Execution,
  type OutputMessage,
} from "@e2b/code-interpreter";
import type { Sandbox, SandboxProvider, ExecChunk } from "./sandbox";

export interface E2BProviderOpts {
  apiKey: string;
  template?: string;
  defaultTimeoutMs?: number;
}

interface CommandResultLike {
  exitCode: number;
  stdout: string;
  stderr: string;
  error?: string;
}

interface AsyncQueue {
  push: (chunk: ExecChunk) => void;
  iter: () => AsyncIterable<ExecChunk>;
  finish: (exitCode: number) => void;
}

function createAsyncQueue(): AsyncQueue {
  const queue: ExecChunk[] = [];
  let resolveNext: (() => void) | null = null;
  let done = false;
  let exitCode = 0;

  const wake = (): void => {
    if (resolveNext) {
      const r = resolveNext;
      resolveNext = null;
      r();
    }
  };

  return {
    push: (chunk: ExecChunk): void => {
      queue.push(chunk);
      wake();
    },
    finish: (code: number): void => {
      exitCode = code;
      done = true;
      wake();
    },
    iter: async function* (): AsyncIterable<ExecChunk> {
      while (true) {
        if (queue.length > 0) {
          yield queue.shift() as ExecChunk;
          continue;
        }
        if (done) {
          yield { type: "exit", code: exitCode };
          return;
        }
        await new Promise<void>((r) => {
          resolveNext = r;
        });
      }
    },
  };
}

export class E2BSandboxProvider implements SandboxProvider {
  constructor(private opts: E2BProviderOpts) {
    if (!opts.apiKey) throw new Error("E2BSandboxProvider: apiKey required");
  }

  async create(sessionId: string): Promise<Sandbox> {
    const createOpts = {
      apiKey: this.opts.apiKey,
      timeoutMs: this.opts.defaultTimeoutMs ?? 10 * 60 * 1000,
      metadata: { sessionId },
    };
    const sb = this.opts.template
      ? await E2BBaseSandbox.create(this.opts.template, createOpts)
      : await E2BBaseSandbox.create(createOpts);
    return new E2BSandbox(sb);
  }
}

class E2BSandbox implements Sandbox {
  readonly id: string;
  constructor(private sb: E2BBaseSandbox) {
    this.id = (sb as unknown as { sandboxId?: string }).sandboxId ?? "unknown";
  }

  runPython(
    code: string,
    opts?: { timeoutMs?: number },
  ): AsyncIterable<ExecChunk> {
    const q = createAsyncQueue();

    const exec = this.sb.runCode(code, {
      timeoutMs: opts?.timeoutMs ?? 30_000,
      onStdout: (out: OutputMessage) => {
        q.push({ type: "stdout", data: out.line });
      },
      onStderr: (out: OutputMessage) => {
        q.push({ type: "stderr", data: out.line });
      },
    });

    exec
      .then((res: Execution) => {
        if (res.error) {
          q.push({
            type: "stderr",
            data: `${res.error.name}: ${res.error.value}\n${res.error.traceback ?? ""}`,
          });
          q.finish(1);
        } else {
          q.finish(0);
        }
      })
      .catch((e: unknown) => {
        q.push({
          type: "stderr",
          data: e instanceof Error ? e.message : String(e),
        });
        q.finish(1);
      });

    return q.iter();
  }

  exec(cmd: string, opts?: { timeoutMs?: number }): AsyncIterable<ExecChunk> {
    const q = createAsyncQueue();

    const proc = this.sb.commands.run(cmd, {
      timeoutMs: opts?.timeoutMs ?? 30_000,
      onStdout: (data: string) => {
        q.push({ type: "stdout", data });
      },
      onStderr: (data: string) => {
        q.push({ type: "stderr", data });
      },
    });

    proc
      .then((res: CommandResultLike) => {
        q.finish(res.exitCode ?? 0);
      })
      .catch((e: unknown) => {
        q.push({
          type: "stderr",
          data: e instanceof Error ? e.message : String(e),
        });
        q.finish(1);
      });

    return q.iter();
  }

  async writeFile(path: string, data: string | Uint8Array): Promise<void> {
    if (typeof data === "string") {
      await this.sb.files.write(path, data);
    } else {
      const ab = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      ) as ArrayBuffer;
      await this.sb.files.write(path, ab);
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    return await this.sb.files.read(path, { format: "bytes" });
  }

  async kill(): Promise<void> {
    await this.sb.kill();
  }
}
