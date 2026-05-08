import React, { useState } from "react";
import { ChevronRight, Terminal } from "lucide-react";
import { type ToolCall } from "../../contexts/ChatContext";
import { cn } from "@common/lib/utils";

export const ToolCallCard: React.FC<{ call: ToolCall }> = ({ call }) => {
  const [open, setOpen] = useState(true);
  const argsStr = (() => {
    try {
      return JSON.stringify(call.args, null, 2);
    } catch {
      return String(call.args);
    }
  })();
  const code =
    typeof call.args === "object" && call.args !== null && "code" in call.args
      ? ((call.args as { code: unknown }).code as string | undefined)
      : undefined;

  return (
    <div className="my-2 border border-border rounded-lg bg-muted/30 dark:bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        <Terminal className="size-3.5" />
        <span className="text-xs font-mono font-semibold">{call.toolName}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {!call.isComplete ? "running…" : call.isError ? "error" : "done"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs font-mono">
          {code !== undefined ? (
            <div>
              <div className="text-muted-foreground mb-1">code</div>
              <pre className="bg-background dark:bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {code}
              </pre>
            </div>
          ) : (
            <div>
              <div className="text-muted-foreground mb-1">args</div>
              <pre className="bg-background dark:bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {argsStr}
              </pre>
            </div>
          )}
          {call.stdout && (
            <div>
              <div className="text-muted-foreground mb-1">stdout</div>
              <pre className="bg-background dark:bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {call.stdout}
              </pre>
            </div>
          )}
          {call.stderr && (
            <div>
              <div className="text-red-500 mb-1">stderr</div>
              <pre className="bg-background dark:bg-secondary border border-red-500/30 rounded p-2 overflow-x-auto whitespace-pre-wrap text-red-500">
                {call.stderr}
              </pre>
            </div>
          )}
          {call.isComplete && call.result !== undefined && (
            <div>
              <div className="text-muted-foreground mb-1">result</div>
              <pre className="bg-background dark:bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {(() => {
                  try {
                    return JSON.stringify(call.result, null, 2);
                  } catch {
                    return String(call.result);
                  }
                })()}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
