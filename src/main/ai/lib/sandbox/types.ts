export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ExecOpts {
  timeoutMs?: number;
}

export interface Sandbox {
  runPython(code: string, opts?: ExecOpts): Promise<ExecResult>;
  runBash(cmd: string, opts?: ExecOpts): Promise<ExecResult>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: string | Uint8Array): Promise<void>;
  kill(): Promise<void>;
}

export interface SandboxProvider {
  create(): Promise<Sandbox>;
}
