import { tool } from "ai";
import { z } from "zod";
import { executeSandbox } from "../../lib/sandbox";

export const writeFileTool = tool({
  title: "write_file",
  description:
    "Write a file in the sandbox. Creates parent directories if needed. " +
    "Pass `encoding: 'base64'` to write binary content.",
  inputSchema: z.object({
    path: z
      .string()
      .describe("Absolute path inside sandbox (e.g. /work/out.txt)."),
    content: z.string().describe("File content. Decoded per `encoding`."),
    encoding: z
      .enum(["utf8", "base64"])
      .optional()
      .describe("Default `utf8`. Use `base64` for binary."),
  }),
  async execute({ path, content, encoding }) {
    const enc = encoding ?? "utf8";
    if (enc === "base64") {
      const buf = Buffer.from(content, "base64");
      const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      await executeSandbox((sb) => sb.writeFile(path, data));
      return { path, bytes: buf.byteLength };
    }
    await executeSandbox((sb) => sb.writeFile(path, content));
    return { path, bytes: Buffer.byteLength(content, "utf8") };
  },
});
