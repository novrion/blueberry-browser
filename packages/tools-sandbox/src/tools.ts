import { z } from "zod";
import type { Tool } from "@blueberry/agent-core";
import type { SandboxManager } from "./manager";
import type { ExecResult } from "./sandbox";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_READ_BYTES = 1_000_000; // 1 MB

// ---------- python ----------

const pythonParams = z.object({
  code: z
    .string()
    .describe(
      "Python source code to execute. Has full Python stdlib + pandas, numpy, etc.",
    ),
});

export function createPythonTool(
  manager: SandboxManager,
): Tool<z.infer<typeof pythonParams>, ExecResult> {
  return {
    name: "python",
    description:
      "Execute Python code in a sandboxed Linux microVM. Returns stdout, stderr, and exit code. " +
      "Use this for data analysis, calculations, file processing, anything that needs Python.",
    parameters: pythonParams,
    async execute({ code }, ctx) {
      const sb = await manager.getOrCreate(ctx.sessionId);
      let stdout = "";
      let stderr = "";
      let exitCode = 0;

      for await (const chunk of sb.runPython(code, {
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })) {
        if (chunk.type === "stdout") {
          stdout += chunk.data;
          ctx.onProgress?.({ type: "stdout", data: chunk.data });
        } else if (chunk.type === "stderr") {
          stderr += chunk.data;
          ctx.onProgress?.({ type: "stderr", data: chunk.data });
        } else if (chunk.type === "exit") {
          exitCode = chunk.code;
        }
      }

      manager.touch(ctx.sessionId);
      return { stdout, stderr, exitCode };
    },
  };
}

// ---------- bash ----------

const bashParams = z.object({
  cmd: z
    .string()
    .describe(
      "Shell command to run in the sandbox. Runs with /bin/sh. Use && / ; for multi-step commands.",
    ),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(120_000)
    .optional()
    .describe("Optional timeout in milliseconds. Default 30000, max 120000."),
});

export function createBashTool(
  manager: SandboxManager,
): Tool<z.infer<typeof bashParams>, ExecResult> {
  return {
    name: "bash",
    description:
      "Run a shell command in the sandboxed Linux microVM. Returns stdout, stderr, and exit code. " +
      "Use for filesystem ops, package installs (`pip install`, `apt-get`), invoking CLIs (ffmpeg, curl, jq).",
    parameters: bashParams,
    async execute({ cmd, timeoutMs }, ctx) {
      const sb = await manager.getOrCreate(ctx.sessionId);
      let stdout = "";
      let stderr = "";
      let exitCode = 0;

      for await (const chunk of sb.exec(cmd, {
        timeoutMs: timeoutMs ?? DEFAULT_TIMEOUT_MS,
      })) {
        if (chunk.type === "stdout") {
          stdout += chunk.data;
          ctx.onProgress?.({ type: "stdout", data: chunk.data });
        } else if (chunk.type === "stderr") {
          stderr += chunk.data;
          ctx.onProgress?.({ type: "stderr", data: chunk.data });
        } else if (chunk.type === "exit") {
          exitCode = chunk.code;
        }
      }

      manager.touch(ctx.sessionId);
      return { stdout, stderr, exitCode };
    },
  };
}

// ---------- read_file ----------

const readFileParams = z.object({
  path: z
    .string()
    .describe(
      "Absolute path inside the sandbox to read (e.g. /work/data.csv).",
    ),
  encoding: z
    .enum(["utf8", "base64"])
    .optional()
    .describe(
      "Return encoding. Default `utf8` for text. Use `base64` for binary files.",
    ),
});

export interface ReadFileResult {
  path: string;
  encoding: "utf8" | "base64";
  content: string;
  bytes: number;
  truncated: boolean;
}

export function createReadFileTool(
  manager: SandboxManager,
): Tool<z.infer<typeof readFileParams>, ReadFileResult> {
  return {
    name: "read_file",
    description:
      "Read a file from the sandbox. Returns up to 1MB. Use `encoding: 'base64'` for binary files.",
    parameters: readFileParams,
    async execute({ path, encoding }, ctx) {
      const sb = await manager.getOrCreate(ctx.sessionId);
      const enc = encoding ?? "utf8";
      const bytes = await sb.readFile(path);
      manager.touch(ctx.sessionId);

      const truncated = bytes.byteLength > MAX_READ_BYTES;
      const slice = truncated ? bytes.subarray(0, MAX_READ_BYTES) : bytes;

      const content =
        enc === "base64"
          ? Buffer.from(slice).toString("base64")
          : new TextDecoder("utf-8", { fatal: false }).decode(slice);

      ctx.onProgress?.({
        type: "info",
        data: `read ${bytes.byteLength} bytes${truncated ? " (truncated to 1MB)" : ""}`,
      });

      return {
        path,
        encoding: enc,
        content,
        bytes: bytes.byteLength,
        truncated,
      };
    },
  };
}

// ---------- write_file ----------

const writeFileParams = z.object({
  path: z
    .string()
    .describe(
      "Absolute path inside the sandbox to write (e.g. /work/out.txt).",
    ),
  content: z
    .string()
    .describe("File content. Decoded according to `encoding`."),
  encoding: z
    .enum(["utf8", "base64"])
    .optional()
    .describe(
      "Encoding of `content`. Default `utf8`. Use `base64` to write binary data.",
    ),
});

export interface WriteFileResult {
  path: string;
  bytes: number;
}

export function createWriteFileTool(
  manager: SandboxManager,
): Tool<z.infer<typeof writeFileParams>, WriteFileResult> {
  return {
    name: "write_file",
    description:
      "Write a file in the sandbox. Creates parent directories if needed. " +
      "Pass `encoding: 'base64'` to write binary content.",
    parameters: writeFileParams,
    async execute({ path, content, encoding }, ctx) {
      const sb = await manager.getOrCreate(ctx.sessionId);
      const enc = encoding ?? "utf8";

      if (enc === "base64") {
        const buf = Buffer.from(content, "base64");
        await sb.writeFile(
          path,
          new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        );
        manager.touch(ctx.sessionId);
        ctx.onProgress?.({
          type: "info",
          data: `wrote ${buf.byteLength} bytes`,
        });
        return { path, bytes: buf.byteLength };
      }

      await sb.writeFile(path, content);
      manager.touch(ctx.sessionId);
      const bytes = Buffer.byteLength(content, "utf8");
      ctx.onProgress?.({ type: "info", data: `wrote ${bytes} bytes` });
      return { path, bytes };
    },
  };
}
