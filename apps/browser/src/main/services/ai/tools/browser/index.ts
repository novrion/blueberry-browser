import type { ToolSet } from "ai";
import type { Tab } from "../../../../windows/Tab";
import { createNavigateTool } from "./navigate";
import { createModifyDomTool } from "./modify-dom";
import { createGetPageTool } from "./get-page";

export { createNavigateTool, createModifyDomTool, createGetPageTool };

export function createBrowserTools(getTab: () => Tab | null): ToolSet {
  return {
    navigate: createNavigateTool(getTab),
    modify_dom: createModifyDomTool(getTab),
    get_page: createGetPageTool(getTab),
  };
}
