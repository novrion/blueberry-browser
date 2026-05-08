import { ToolLoopAgent, stepCountIs, type LanguageModel } from "ai";
import { createBrowserAgentInstructions } from "./instructions";
import { getToolInstructions } from "../../instructions";
import { MAX_CONTEXT_LENGTH } from "./constants";
import { truncateText } from "../../../utils";
import { sandboxTools } from "../../tools";

export interface CreateBrowserAgentOptions {
  model: LanguageModel;
  maxSteps: number;
  url: string | null;
  pageText: string | null;
  temperature: number | 0.7;
}

export function createBrowserAgent({
  model,
  maxSteps,
  url,
  pageText,
  temperature,
}: CreateBrowserAgentOptions): ToolLoopAgent {
  const tools = sandboxTools;
  const toolInstructions = getToolInstructions(tools);
  const pageContext = pageText
    ? truncateText(pageText, MAX_CONTEXT_LENGTH)
    : null;
  const instructions = createBrowserAgentInstructions({
    toolInstructions,
    url,
    pageContext,
  });

  return new ToolLoopAgent({
    model,
    instructions,
    tools,
    temperature,
    stopWhen: stepCountIs(maxSteps),
  });
}
