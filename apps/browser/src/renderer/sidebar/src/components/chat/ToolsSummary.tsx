import React, { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { type ToolCall } from "../../contexts/ChatContext";
import { cn } from "@common/lib/utils";
import { getToolMeta, getToolPreview } from "../../lib/toolMeta";

const ToolDetail: React.FC<{ call: ToolCall }> = ({ call }) => {
  const args = (call.args ?? {}) as Record<string, unknown>;
  const result = call.result as
    | { stdout?: string; stderr?: string; exitCode?: number }
    | undefined;
  const stdout = call.stdout || result?.stdout || "";
  const stderr = call.stderr || result?.stderr || "";
  const exitCode = result?.exitCode;

  const inputContent =
    call.toolName === "python" && typeof args.code === "string"
      ? args.code
      : call.toolName === "bash" && typeof args.cmd === "string"
        ? args.cmd
        : (call.toolName === "read_file" || call.toolName === "write_file") &&
            typeof args.path === "string"
          ? args.path
          : (() => {
              try {
                return JSON.stringify(call.args, null, 2);
              } catch {
                return String(call.args);
              }
            })();

  return (
    <div className="space-y-1.5">
      <Block content={inputContent} />
      {stdout && <Block content={stdout} label="stdout" />}
      {stderr && <Block content={stderr} label="stderr" tone="error" />}
      {typeof exitCode === "number" && exitCode !== 0 && (
        <div className="text-[11px] font-mono text-red-500">
          exit {exitCode}
        </div>
      )}
    </div>
  );
};

const Block: React.FC<{
  content: string;
  label?: string;
  tone?: "error";
}> = ({ content, label, tone }) => (
  <div>
    {label && (
      <div
        className={cn(
          "text-[10px] uppercase tracking-wide mb-0.5",
          tone === "error" ? "text-red-500" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
    )}
    <pre
      className={cn(
        "bg-muted/40 dark:bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap text-xs font-mono",
        tone === "error" ? "text-red-500" : "text-foreground/80",
      )}
    >
      {content}
    </pre>
  </div>
);

const ToolRow: React.FC<{ call: ToolCall }> = ({ call }) => {
  const [open, setOpen] = useState(false);
  const meta = getToolMeta(call.toolName);
  const Icon = meta.icon;
  const preview = getToolPreview(call);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-xs hover:opacity-70 transition-opacity text-left"
      >
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            call.isError ? "text-red-500" : "text-muted-foreground",
          )}
        />
        <span
          className={cn(
            "font-medium shrink-0",
            call.isError ? "text-red-500" : "text-foreground/80",
          )}
        >
          {meta.doneLabel}
        </span>
        {preview && (
          <span className="text-muted-foreground truncate font-mono">
            {preview}
          </span>
        )}
        <ChevronDown
          className={cn(
            "size-3 text-muted-foreground transition-transform shrink-0",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="mt-1.5 ml-5 mb-1">
          <ToolDetail call={call} />
        </div>
      )}
    </div>
  );
};

export const ToolsSummary: React.FC<{ calls: ToolCall[] }> = ({ calls }) => {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const completed = calls.filter((c) => c.isComplete);

  useEffect(() => {
    if (completed.length === 0) return;
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, [completed.length]);

  if (completed.length === 0) return null;

  return (
    <div
      className={cn(
        "mb-3 transition-all duration-300 ease-out",
        mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-1",
      )}
    >
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>
          Ran {completed.length} {completed.length === 1 ? "tool" : "tools"}
        </span>
        <ChevronDown
          className={cn("size-3 transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-0.5">
          {completed.map((c) => (
            <ToolRow key={c.toolCallId} call={c} />
          ))}
        </div>
      )}
    </div>
  );
};
