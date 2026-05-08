import { ToolLoopAgent, stepCountIs, type LanguageModel } from "ai";
import { createBrowserAgentInstructions } from "./instructions";
import {
	getToolInstructions,
	getBrowserToolInstructions,
} from "../../instructions";
import { sandboxTools, createBrowserTools } from "../../tools";
import type { Tab } from "../../../../windows/Tab";

export interface CreateBrowserAgentOptions {
	model: LanguageModel;
	maxSteps?: number;
	url?: string | null;
	temperature?: number;
	maxOutputTokens?: number;
	getTab?: () => Tab | null | undefined;
}

export function createBrowserAgent({
	model,
	maxSteps = 50,
	url,
	temperature = 0.7,
	maxOutputTokens = 8192,
	getTab,
}: CreateBrowserAgentOptions): ToolLoopAgent {
	const browserTools = createBrowserTools(() => getTab?.() ?? null);
	const tools = { ...sandboxTools, ...browserTools };
	const toolInstructions = getToolInstructions(tools);
	const instructions = createBrowserAgentInstructions({
		toolInstructions,
		url: url ?? null,
	});

	return new ToolLoopAgent({
		model,
		instructions,
		tools,
		temperature,
		maxOutputTokens,
		stopWhen: stepCountIs(maxSteps),
	});
}
