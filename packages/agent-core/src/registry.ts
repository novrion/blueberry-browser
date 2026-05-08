import { dynamicTool as _dynamicTool, type ToolSet } from "ai";
import type { Tool, ToolContext, ToolProgress } from "./types";

// `dynamicTool`'s generic shape causes TS2589 (deep instantiation) when called
// from a strict tsconfig context. We narrow its signature here so the call
// site stays simple — input/output are intentionally `unknown` since this
// registry routes runtime-validated args through zod schemas.
type DynamicToolInput = {
  description?: string;
  inputSchema: unknown;
  execute: (
    args: unknown,
    opts: { toolCallId: string; abortSignal?: AbortSignal },
  ) => Promise<unknown>;
};
type DynamicToolValue = ToolSet[string];
const dynamicTool = _dynamicTool as unknown as (
  t: DynamicToolInput,
) => DynamicToolValue;

type AnyTool = Tool<unknown, unknown>;

export class ToolRegistry {
  private tools = new Map<string, AnyTool>();

  register<TArgs, TResult>(t: Tool<TArgs, TResult>): void {
    if (this.tools.has(t.name)) {
      throw new Error(`Tool already registered: ${t.name}`);
    }
    this.tools.set(t.name, t as unknown as AnyTool);
  }

  list(): AnyTool[] {
    return Array.from(this.tools.values());
  }

  get(name: string): AnyTool | undefined {
    return this.tools.get(name);
  }

  toAISDKTools(
    ctxFactory: (toolName: string, toolCallId: string) => ToolContext,
  ): ToolSet {
    const out: ToolSet = {};
    for (const t of this.tools.values()) {
      out[t.name] = buildDynamicTool(t, ctxFactory);
    }
    return out;
  }
}

function buildDynamicTool(
  t: AnyTool,
  ctxFactory: (toolName: string, toolCallId: string) => ToolContext,
): DynamicToolValue {
  return dynamicTool({
    description: t.description,
    inputSchema: t.parameters,
    execute: async (args, opts) => {
      const ctx = ctxFactory(t.name, opts.toolCallId);
      ctx.signal = opts.abortSignal;
      return await t.execute(args, ctx);
    },
  });
}

export type { ToolProgress };
