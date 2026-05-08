import type { ToolSet } from "ai";

const map: Record<string, string> = {
  navigate:
    "- `navigate(url)` loads a URL in the active browser tab. Use to move to a new page.",
  modify_dom:
    "- `modify_dom(script)` runs JavaScript in the active tab to read or mutate its DOM. " +
    "Final expression value is returned (JSON-serialized).",
  get_page:
    "- `get_page(mode)` reads the active tab. " +
    "`mode: 'html'` returns outerHTML, `'text'` returns innerText, `'screenshot'` returns a PNG data URL.",
};

export function getBrowserToolInstructions(tools: ToolSet): string[] {
  const instructions: string[] = [];
  for (const name of Object.keys(tools)) {
    if (map[name]) instructions.push(map[name]);
  }
  return instructions;
}
