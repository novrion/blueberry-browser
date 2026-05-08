import React, { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { type ToolCall } from "../../contexts/ChatContext";
import { cn } from "@common/lib/utils";
import { getToolMeta } from "../../lib/toolMeta";

const MIN_DISPLAY_MS = 700;
const FADE_MS = 220;

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

type Phase = "enter" | "visible" | "leaving" | "gone";

export const ToolCallCard: React.FC<{ call: ToolCall }> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>("enter");
  const startRef = useRef(Date.now());

  useEffect(() => {
    const id = requestAnimationFrame(() => setPhase("visible"));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!call.isComplete) return;
    const elapsed = Date.now() - startRef.current;
    const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
    const t1 = setTimeout(() => setPhase("leaving"), remaining);
    const t2 = setTimeout(() => setPhase("gone"), remaining + FADE_MS);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [call.isComplete]);

  if (phase === "gone") return null;

  const meta = getToolMeta(call.toolName);
  const Icon = meta.icon;
  const isLeaving = phase === "leaving";
  const isEntering = phase === "enter";

  return (
    <div
      style={{ transitionDuration: `${FADE_MS}ms` }}
      className={cn(
        "transition-all ease-out overflow-hidden",
        isEntering && "opacity-0 max-h-0 my-0 -translate-y-0.5",
        phase === "visible" && "opacity-100 max-h-96 my-1 translate-y-0",
        isLeaving && "opacity-0 max-h-0 my-0 -translate-y-0.5",
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        disabled={isLeaving}
        className="flex items-center gap-2 hover:opacity-70 transition-opacity"
      >
        <Icon className="size-4 text-muted-foreground shrink-0" />
        <span
          className={cn(
            "text-sm font-medium bg-clip-text text-transparent bg-[length:200%_100%]",
            "bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground",
            !call.isComplete && "animate-shimmer",
            call.isComplete && "opacity-80",
          )}
        >
          {call.isComplete ? meta.doneLabel : `${meta.runningLabel}...`}
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
