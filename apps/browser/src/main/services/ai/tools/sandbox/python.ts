import { tool } from "ai";
import { z } from "zod";
import { executeSandbox } from "../../lib/sandbox";

export const pythonTool = tool({
  title: "python",
  description: [
    "Execute Python 3 code in a sandboxed Linux microVM. Returns stdout, stderr, and exit code.",
    "Use for data analysis, calculations, file processing, anything that needs Python.",
    "The VM is isolated and **cannot install new packages** (no `pip install`) — only the pre-installed libraries below are available.",
    "Available libs: stdlib,",
    "numerics (numpy, scipy),",
    "data (pandas, python-dateutil, six),",
    "plotting (matplotlib),",
    "imaging (pillow),",
    "spreadsheets (openpyxl, xlsxwriter),",
    "http/scraping (requests, beautifulsoup4, lxml),",
    "serialization (pyyaml),",
    "templating (jinja2),",
    "cli/output (tabulate, tqdm).",
  ].join(" "),
  inputSchema: z.object({
    code: z.string().describe("Python 3 source code."),
  }),
  async execute({ code }) {
    return executeSandbox((sb) => sb.runPython(code));
  },
});
