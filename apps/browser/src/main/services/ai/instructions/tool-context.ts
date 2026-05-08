import type { ToolSet } from "ai";

const sandboxTools: Record<string, string> = {
	python: "- `python(code)` runs Python (stdlib + pandas, numpy, etc.).",
	bash: "- `bash(cmd)` runs shell commands. Use for filesystem ops, CLIs.",
	read_file: "- `read_file(path)` reads a file from the sandbox.",
	write_file: "- `write_file(path, content)` writes a file in the sandbox.",
};

const browserTools: Record<string, string> = {
	navigate:
		"- `navigate(url)` loads a URL in the active browser tab. Use to move to a new page.",
	modify_dom:
		"- `modify_dom(script)` runs JavaScript in the active tab to read or mutate its DOM. " +
		"Final expression value is returned (JSON-serialized).",
	get_page:
		"- `get_page(mode)` reads the active tab. " +
		"`mode: 'html'` returns outerHTML, `'text'` returns innerText, `'screenshot'` returns a PNG data URL.",
};

export function getToolInstructions(tools: ToolSet): string[] {
	const instructions: string[] = [];
	const toolNames = Object.keys(tools);

	const hasSandboxTools = toolNames.some((name) => name in sandboxTools);
	const hasBrowserTools = toolNames.some((name) => name in browserTools);

	if (hasSandboxTools || hasBrowserTools) {
		instructions.push("========== TOOLS ==========");
	}

	if (hasSandboxTools) {
		const parts = [
			"===== **Sandbox tools** =====",
			"— execute code in an isolated VM (user uploaded files are already in the VM)",
			"\n",
		];
		for (const part of parts) {
			instructions.push(part);
		}
		for (const name of toolNames) {
			if (sandboxTools[name]) instructions.push(sandboxTools[name]);
		}
	}

	if (hasBrowserTools) {
		const parts = [
			"===== **Browser tools** ===== ",
			"— interact with the active browser",
			"\n",
		];
		for (const part of parts) {
			instructions.push(part);
		}
		for (const name of toolNames) {
			if (browserTools[name]) instructions.push(browserTools[name]);
		}
	}

	return instructions;
}
