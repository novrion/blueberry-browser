export type ExecChunk =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "exit"; code: number };

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface Sandbox {
  id: string;
  runPython(
    code: string,
    opts?: { timeoutMs?: number },
  ): AsyncIterable<ExecChunk>;
  exec(cmd: string, opts?: { timeoutMs?: number }): AsyncIterable<ExecChunk>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<Uint8Array>;
  kill(): Promise<void>;
}

export interface SandboxProvider {
  create(sessionId: string): Promise<Sandbox>;
}
