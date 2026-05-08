import {
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import type { ToolRegistry } from "./registry";
import type {
  ToolContext,
  ToolCallEvent,
  ToolResultEvent,
  ToolProgress,
} from "./types";

export interface RunAgentOpts {
  model: LanguageModel;
  messages: ModelMessage[];
  registry: ToolRegistry;
  sessionId: string;
  temperature?: number;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  onTextChunk?: (chunk: string) => void;
  onToolCall?: (e: ToolCallEvent) => void;
  onToolResult?: (e: ToolResultEvent) => void;
  onToolProgress?: (toolCallId: string, p: ToolProgress) => void;
}

export interface RunAgentResult {
  finalText: string;
  messages: ModelMessage[];
}

export async function runAgent(opts: RunAgentOpts): Promise<RunAgentResult> {
  const {
    model,
    messages,
    registry,
    sessionId,
    temperature = 0.7,
    maxSteps = 5,
    abortSignal,
    onTextChunk,
    onToolCall,
    onToolResult,
    onToolProgress,
  } = opts;

  const ctxFactory = (_toolName: string, toolCallId: string): ToolContext => ({
    sessionId,
    onProgress: (p) => onToolProgress?.(toolCallId, p),
  });

  const tools = registry.toAISDKTools(ctxFactory);

  const result = streamText({
    model,
    messages,
    tools,
    temperature,
    stopWhen: stepCountIs(maxSteps),
    abortSignal,
    onError: ({ error }) => {
      console.error("[agent-core] streamText error:", error);
    },
  });

  let finalText = "";

  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      finalText += part.text;
      onTextChunk?.(part.text);
    } else if (part.type === "tool-call") {
      onToolCall?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        args: part.input,
      });
    } else if (part.type === "tool-result") {
      onToolResult?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: part.output,
      });
    } else if (part.type === "tool-error") {
      onToolResult?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        result: part.error,
        isError: true,
      });
    } else if (part.type === "error") {
      throw part.error instanceof Error
        ? part.error
        : new Error(String(part.error));
    }
  }

  const responseMessages = (await result.response).messages;
  return { finalText, messages: responseMessages as ModelMessage[] };
}
