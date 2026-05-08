import type { z } from "zod";
import type { ModelMessage } from "ai";

export type AgentMessage = ModelMessage;

export interface ToolContext {
  sessionId: string;
  signal?: AbortSignal;
  onProgress?: (chunk: ToolProgress) => void;
}

export type ToolProgress =
  | { type: "stdout"; data: string }
  | { type: "stderr"; data: string }
  | { type: "info"; data: string };

export interface Tool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<TArgs>;
  execute: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
}

export interface ToolCallEvent {
  toolCallId: string;
  toolName: string;
  args: unknown;
}

export interface ToolResultEvent {
  toolCallId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}
