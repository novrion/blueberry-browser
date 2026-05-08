import { tool } from "ai";
import { z } from "zod";
import type { Tab } from "../../../../windows/Tab";

export function createModifyDomTool(
  getTab: () => Tab | null,
): ReturnType<typeof tool> {
  return tool({
    title: "modify_dom",
    description:
      "Run JavaScript inside the active tab to read or mutate its DOM. " +
      "Code runs in the page context. The expression's value (last statement) is returned, JSON-serialized. " +
      "Examples: `document.querySelector('#btn').click()`, " +
      "`document.body.style.background = 'red'`, " +
      "`Array.from(document.querySelectorAll('a')).map(a => a.href)`.",
    inputSchema: z.object({
      script: z
        .string()
        .describe(
          "JavaScript to execute in the tab. Async/await supported. Final expression value is returned.",
        ),
    }),
    async execute({ script }) {
      const tab = getTab();
      if (!tab) throw new Error("No active tab.");
      const result = await tab.runJs(script);
      return { result };
    },
  });
}
