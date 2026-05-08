import { tool } from "ai";
import { z } from "zod";
import type { Tab } from "../../../../windows/Tab";

export function createNavigateTool(
  getTab: () => Tab | null,
): ReturnType<typeof tool> {
  return tool({
    title: "navigate",
    description:
      "Navigate the active browser tab to a URL. Waits for the page load to settle. " +
      "Returns the resulting URL and title.",
    inputSchema: z.object({
      url: z
        .string()
        .describe("Absolute URL to load (e.g. https://example.com)."),
    }),
    async execute({ url }) {
      const tab = getTab();
      if (!tab) throw new Error("No active tab.");
      await tab.loadURL(url);
      return { url: tab.url, title: tab.title };
    },
  });
}
