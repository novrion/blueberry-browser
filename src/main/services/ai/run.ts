import type { ModelMessage, ToolLoopAgent, ToolSet } from "ai";

export interface StreamAgentCallbacks {
  onTextDelta?: (text: string) => void;
  onToolCallStart?: (e: { toolCallId: string; toolName: string }) => void;
  onToolCall?: (e: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  }) => void;
  onToolResult?: (e: {
    toolCallId: string;
    toolName: string;
    output: unknown;
    isError?: boolean;
  }) => void;
}

export interface StreamAgentResult {
  text: string;
  responseMessages: ModelMessage[];
}

export async function streamAgent(
  agent: ToolLoopAgent<unknown, ToolSet, never>,
  messages: ModelMessage[],
  cbs: StreamAgentCallbacks = {},
): Promise<StreamAgentResult> {
  const result = await agent.stream({ messages });
  let text = "";
  for await (const part of result.fullStream) {
    if (part.type === "text-delta") {
      text += part.text;
      cbs.onTextDelta?.(part.text);
    } else if (part.type === "tool-input-start") {
      cbs.onToolCallStart?.({
        toolCallId: part.id,
        toolName: part.toolName,
      });
    } else if (part.type === "tool-call") {
      cbs.onToolCall?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      });
    } else if (part.type === "tool-result") {
      cbs.onToolResult?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: part.output,
      });
    } else if (part.type === "tool-error") {
      cbs.onToolResult?.({
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        output: part.error,
        isError: true,
      });
    } else if (part.type === "error") {
      throw part.error instanceof Error
        ? part.error
        : new Error(String(part.error));
    }
  }
  const responseMessages = (await result.response).messages as ModelMessage[];
  return { text, responseMessages };
}
