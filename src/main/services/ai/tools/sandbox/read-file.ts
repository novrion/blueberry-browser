import { tool } from "ai";
import { z } from "zod";
import { executeSandbox } from "../../lib/sandbox";

const MAX_READ_BYTES = 1_000_000;

export const readFileTool = tool({
  title: "read_file",
  description:
    "Read a file from the sandbox. Returns up to 1MB. Use `encoding: 'base64'` for binary files.",
  inputSchema: z.object({
    path: z
      .string()
      .describe("Absolute path inside sandbox (e.g. /work/data.csv)."),
    encoding: z
      .enum(["utf8", "base64"])
      .optional()
      .describe("Default `utf8`. Use `base64` for binary."),
  }),
  async execute({ path, encoding }) {
    const enc = encoding ?? "utf8";
    const bytes = await executeSandbox((sb) => sb.readFile(path));
    const truncated = bytes.byteLength > MAX_READ_BYTES;
    const slice = truncated ? bytes.subarray(0, MAX_READ_BYTES) : bytes;
    const content =
      enc === "base64"
        ? Buffer.from(slice).toString("base64")
        : new TextDecoder("utf-8", { fatal: false }).decode(slice);
    return {
      path,
      encoding: enc,
      content,
      bytes: bytes.byteLength,
      truncated,
    };
  },
});
