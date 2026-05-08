export interface CreateBrowserAgentInstructionsOptions {
  toolInstructions: string[] | null;
  url: string | null;
  pageContext: string | null;
}

export function createBrowserAgentInstructions({
  toolInstructions,
  url,
  pageContext,
}: CreateBrowserAgentInstructionsOptions): string {
  const parts: string[] = [
    "You are a helpful AI assistant integrated into a web browser.",
    "You can analyze and discuss web pages with the user.",
    "The user's messages may include screenshots of the current page as the first image.",
  ];

  if (url) parts.push(`\nCurrent page URL: ${url}`);
  if (pageContext) {
    parts.push(`\nPage content (text):\n${pageContext}`);
  }

  if (toolInstructions && toolInstructions.length > 0) {
    parts.push("\n\n========== TOOLS ==========");
    for (const instruction of toolInstructions) {
      parts.push(instruction);
    }
    parts.push("\n\n");
  }

  parts.push(
    "\nProvide helpful, accurate, and contextual responses about the current webpage.",
    "If the user asks about specific content, refer to the page content and/or screenshot provided.",
  );

  return parts.join("\n");
}
