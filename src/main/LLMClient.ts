import { WebContents } from "electron";
import type { LanguageModel, ModelMessage, UserContent } from "ai";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import { createBrowserAgent, selectModel, streamAgent } from "./ai";

dotenv.config({ path: join(__dirname, "../../.env") });

interface Attachment {
  name: string;
  mime: string;
  size: number;
  base64: string;
}

interface ChatRequest {
  message: string;
  messageId: string;
  attachments?: Attachment[];
}

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly model: LanguageModel | null;
  private messages: ModelMessage[] = [];

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.model = selectModel();
  }

  setWindow(window: Window): void {
    this.window = window;
  }

  getMessages(): ModelMessage[] {
    return this.messages;
  }

  clearMessages(): void {
    this.messages = [];
    this.webContents.send("chat-messages-updated", this.messages);
  }

  async sendChatMessage(req: ChatRequest): Promise<void> {
    if (!this.model) {
      this.streamChunk(
        req.messageId,
        "LLM not configured. Add API key to .env.",
        true,
      );
      return;
    }

    const userContent = await this.buildUserContent(req);
    this.messages.push({
      role: "user",
      content: userContent.length === 1 ? req.message : userContent,
    });
    this.webContents.send("chat-messages-updated", this.messages);

    const { url, pageText } = await this.getPageContext();
    const agent = createBrowserAgent({
      model: this.model,
      maxSteps: 10,
      url,
      pageText,
    });

    const idx = this.messages.length;
    this.messages.push({ role: "assistant", content: "" });
    let acc = "";
    const flushAssistant = (): void => {
      this.messages[idx] = { role: "assistant", content: acc };
      this.webContents.send("chat-messages-updated", this.messages);
    };

    try {
      await streamAgent(agent, this.messages.slice(0, -1), {
        onTextDelta: (chunk) => {
          acc += chunk;
          flushAssistant();
          this.streamChunk(req.messageId, chunk, false);
        },
        onToolCall: (e) =>
          this.toolEvent("tool-call", req.messageId, {
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            args: e.input,
          }),
        onToolResult: (e) =>
          this.toolEvent("tool-result", req.messageId, {
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            result: e.output,
            isError: e.isError,
          }),
      });
      this.streamChunk(req.messageId, acc, true);
    } catch (e) {
      console.error("[LLMClient] stream error:", e);
      this.streamChunk(req.messageId, this.errorMessage(e), true);
    }
  }

  private async buildUserContent(req: ChatRequest): Promise<UserContent> {
    const content: UserContent = [];
    const screenshot = await this.captureScreenshot();
    if (screenshot) content.push({ type: "image", image: screenshot });
    for (const a of req.attachments ?? []) {
      if (a.mime.startsWith("image/")) {
        content.push({
          type: "image",
          image: `data:${a.mime};base64,${a.base64}`,
        });
      }
    }
    content.push({ type: "text", text: req.message });
    return content;
  }

  private async captureScreenshot(): Promise<string | null> {
    const tab = this.window?.activeTab;
    if (!tab) return null;
    try {
      return (await tab.screenshot()).toDataURL();
    } catch (e) {
      console.error("Failed to capture screenshot:", e);
      return null;
    }
  }

  private async getPageContext(): Promise<{
    url: string | null;
    pageText: string | null;
  }> {
    const tab = this.window?.activeTab;
    if (!tab) return { url: null, pageText: null };
    try {
      return { url: tab.url, pageText: await tab.getTabText() };
    } catch (e) {
      console.error("Failed to get page text:", e);
      return { url: tab.url, pageText: null };
    }
  }

  private toolEvent(kind: string, messageId: string, payload: object): void {
    this.webContents.send("agent-tool-event", { kind, messageId, ...payload });
  }

  private streamChunk(
    messageId: string,
    content: string,
    isComplete: boolean,
  ): void {
    this.webContents.send("chat-response", { messageId, content, isComplete });
  }

  private errorMessage(e: unknown): string {
    if (!(e instanceof Error)) return "Unexpected error.";
    const m = e.message.toLowerCase();
    if (m.includes("401") || m.includes("unauthorized"))
      return "Auth error: check API key in .env.";
    if (m.includes("429") || m.includes("rate limit"))
      return "Rate limited. Retry shortly.";
    if (
      m.includes("network") ||
      m.includes("fetch") ||
      m.includes("econnrefused")
    )
      return "Network error.";
    if (m.includes("timeout")) return "Request timeout.";
    return `Error: ${e.message}`;
  }
}
