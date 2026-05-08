import type { ToolSet } from "ai";

const map: Record<string, string> = {
  python: "- `python(code)` runs Python (stdlib + pandas, numpy, etc.).",
  bash: "- `bash(cmd)` runs shell commands. Use for filesystem ops, package installs, CLIs.",
  read_file: "- `read_file(path)` reads a file from the sandbox.",
  write_file: "- `write_file(path, content)` writes a file in the sandbox.",
};

export function getToolInstructions(tools: ToolSet): string[] {
  const instructions: string[] = [];
  for (const name of Object.keys(tools)) {
    if (map[name]) instructions.push(map[name]);
  }
  return instructions;
}
