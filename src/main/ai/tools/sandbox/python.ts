import { tool } from "ai";
import { z } from "zod";
import { executeSandbox } from "../../lib/sandbox";

export const pythonTool = tool({
  title: "python",
  description:
    "Execute Python code in a sandboxed Linux microVM. Returns stdout, stderr, and exit code. " +
    "Use for data analysis, calculations, file processing, anything that needs Python.",
  inputSchema: z.object({
    code: z
      .string()
      .describe("Python source code. Has stdlib + pandas, numpy, etc."),
  }),
  async execute({ code }) {
    return executeSandbox((sb) => sb.runPython(code));
  },
});
