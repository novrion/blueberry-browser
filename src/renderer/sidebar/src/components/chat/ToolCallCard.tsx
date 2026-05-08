import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { type ToolCall } from "../../contexts/ChatContext";
import { cn } from "@common/lib/utils";
import { getToolMeta } from "../../lib/toolMeta";

const Detail: React.FC<{ call: ToolCall }> = ({ call }) => {
  const args = (call.args ?? {}) as Record<string, unknown>;
  if (call.toolName === "python" && typeof args.code === "string") {
    return <CodeBlock content={args.code} />;
  }
  if (call.toolName === "bash" && typeof args.cmd === "string") {
    return <CodeBlock content={args.cmd} />;
  }
  if (
    (call.toolName === "read_file" || call.toolName === "write_file") &&
    typeof args.path === "string"
  ) {
    return (
      <div className="text-xs font-mono text-muted-foreground">{args.path}</div>
    );
  }
  return (
    <CodeBlock
      content={(() => {
        try {
          return JSON.stringify(call.args, null, 2);
        } catch {
          return String(call.args);
        }
      })()}
    />
  );
};

const CodeBlock: React.FC<{ content: string }> = ({ content }) => (
  <pre className="bg-muted/40 dark:bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap text-xs font-mono text-foreground/80">
    {content}
  </pre>
);

export const ToolCallCard: React.FC<{ call: ToolCall }> = ({ call }) => {
  const [open, setOpen] = useState(false);

  if (call.isComplete) return null;

  const meta = getToolMeta(call.toolName);
  const Icon = meta.icon;

  return (
    <div className="my-1">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 hover:opacity-70 transition-opacity"
      >
        <Icon className="size-4 text-muted-foreground shrink-0" />
        <span
          className="text-sm font-medium bg-clip-text text-transparent bg-[length:200%_100%] animate-shimmer
                     bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground"
        >
          {meta.runningLabel}...
        </span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform shrink-0",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mt-2 ml-6">
          <Detail call={call} />
        </div>
      )}
    </div>
  );
};
