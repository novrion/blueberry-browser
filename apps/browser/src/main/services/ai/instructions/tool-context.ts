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
			"",
			"User-uploaded files live at `/work/`. Reference them by absolute path (e.g. `/work/data.xlsx`).",
			"The VM is **isolated and immutable** — you CANNOT install new packages (no `pip install`, no `apk add`, no network installs).",
			"If a Python lib is missing, it is not coming. Do NOT loop trying to install it. Use a different lib from the available list, or fall back to a non-Python tool (poppler-utils, imagemagick, jq, sqlite) via `bash`.",
			"",
			"File-format guidance (avoid common dead ends):",
			"- `.xlsx` → `pd.read_excel(path)` (engine: openpyxl). It IS a zip; `unzip -l` works.",
			"- `.xls` (legacy) → `pd.read_excel(path)` (engine: xlrd, installed). It is OLE2/CFB binary — `unzip` will NOT work, do not try.",
			"- `.csv` / `.tsv` → `pd.read_csv(path, sep=...)`.",
			"- `.html` tables → `pd.read_html(path)` (html5lib installed).",
			"- `.pdf` → `pdftotext` / `pdfinfo` / `pdftoppm` (poppler-utils) via `bash`. Don't `strings` PDFs.",
			"- `.json` / `.yaml` → stdlib `json` / `yaml`.",
			"- Don't run `strings | grep` on structured binaries to extract data — use the proper parser.",
			"",
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
