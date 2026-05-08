import { tool } from "ai";
import { z } from "zod";
import { executeSandbox } from "../../lib/sandbox";

export const bashTool = tool({
  title: "bash",
  description:
    "Run a shell command in the sandboxed Linux microVM. Returns stdout, stderr, and exit code. " +
    "Use for filesystem ops, package installs (`pip install`, `apt-get`), invoking CLIs (ffmpeg, curl, jq).",
  inputSchema: z.object({
    cmd: z
      .string()
      .describe("Shell command. Runs with /bin/sh. Use && / ; for multi-step."),
    timeoutMs: z
      .number()
      .int()
      .positive()
      .max(120_000)
      .optional()
      .describe("Optional timeout in ms. Default 30000, max 120000."),
  }),
  async execute({ cmd, timeoutMs }) {
    return executeSandbox((sb) => sb.runBash(cmd, { timeoutMs }));
  },
});
