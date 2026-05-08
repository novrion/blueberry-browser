import {
  Code2,
  Terminal,
  FileText,
  FilePen,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { ToolCall } from "../contexts/ChatContext";

export interface ToolMeta {
  icon: LucideIcon;
  runningLabel: string;
  doneLabel: string;
}

const MAP: Record<string, ToolMeta> = {
  python: {
    icon: Code2,
    runningLabel: "Running python",
    doneLabel: "Python",
  },
  bash: {
    icon: Terminal,
    runningLabel: "Running bash",
    doneLabel: "Bash",
  },
  read_file: {
    icon: FileText,
    runningLabel: "Reading file",
    doneLabel: "Read file",
  },
  write_file: {
    icon: FilePen,
    runningLabel: "Writing file",
    doneLabel: "Wrote file",
  },
};

export function getToolMeta(name: string): ToolMeta {
  return (
    MAP[name] ?? {
      icon: Wrench,
      runningLabel: `Running ${name}`,
      doneLabel: name,
    }
  );
}

function firstLine(s: string): string {
  const i = s.indexOf("\n");
  return (i === -1 ? s : s.slice(0, i)).trim();
}

export function getToolPreview(call: ToolCall): string {
  const args = (call.args ?? {}) as Record<string, unknown>;
  if (call.toolName === "python" && typeof args.code === "string") {
    return firstLine(args.code);
  }
  if (call.toolName === "bash" && typeof args.cmd === "string") {
    return firstLine(args.cmd);
  }
  if (
    (call.toolName === "read_file" || call.toolName === "write_file") &&
    typeof args.path === "string"
  ) {
    return args.path;
  }
  return "";
}
