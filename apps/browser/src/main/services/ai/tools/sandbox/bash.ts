import { tool } from "ai";
import { z } from "zod";
import { executeSandbox } from "../../lib/sandbox";

export const bashTool = tool({
  title: "bash",
  description: [
    "Run a shell command in the sandboxed Linux microVM (Alpine). Returns stdout, stderr, and exit code.",
    "The VM is isolated and **cannot install new packages** — only the pre-installed tools below are available.",
    "Available tools:",
    "shell/core (bash, coreutils, findutils, grep, sed, gawk),",
    "network (curl, wget, ca-certificates, iproute2),",
    "vcs (git),",
    "data (jq, sqlite, file),",
    "archive (tar, gzip, xz, zip, unzip),",
    "media (imagemagick, poppler-utils — pdftotext/pdfinfo/pdftoppm),",
    "python3 (see `python` tool for libs).",
  ].join(" "),
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
