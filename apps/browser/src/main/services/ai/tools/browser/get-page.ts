import { tool } from "ai";
import { z } from "zod";
import type { Tab } from "../../../../windows/Tab";

const MAX_CHARS = 200_000;

export function createGetPageTool(
  getTab: () => Tab | null,
): ReturnType<typeof tool> {
  return tool({
    title: "get_page",
    description:
      "Read the active tab's current state. " +
      "`mode: 'html'` returns outerHTML, `'text'` returns innerText, " +
      "`'screenshot'` returns a PNG data URL of the visible viewport.",
    inputSchema: z.object({
      mode: z
        .enum(["html", "text", "screenshot"])
        .describe("What to return: page HTML, page text, or screenshot."),
    }),
    async execute({ mode }) {
      const tab = getTab();
      if (!tab) throw new Error("No active tab.");

      if (mode === "screenshot") {
        const img = await tab.screenshot();
        return {
          mode,
          url: tab.url,
          title: tab.title,
          dataUrl: img.toDataURL(),
        };
      }

      const raw =
        mode === "html" ? await tab.getTabHtml() : await tab.getTabText();
      const truncated = raw.length > MAX_CHARS;
      const content = truncated ? raw.slice(0, MAX_CHARS) : raw;
      return {
        mode,
        url: tab.url,
        title: tab.title,
        content,
        chars: raw.length,
        truncated,
      };
    },
  });
}
