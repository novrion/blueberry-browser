import { WebContents } from "electron";
import type { LanguageModel, ModelMessage, UserContent } from "ai";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "../windows/Window";
import {
  createBrowserAgent,
  executeSandbox,
  selectModel,
  streamAgent,
} from "./ai";

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
    return this.displayMessages();
  }

  clearMessages(): void {
    this.messages = [];
    this.broadcast();
  }

  private displayMessages(): ModelMessage[] {
    const extractText = (c: ModelMessage["content"]): string => {
      if (typeof c === "string") return c;
      if (Array.isArray(c)) {
        return c
          .filter(
            (p): p is { type: "text"; text: string } =>
              (p as { type: string }).type === "text" &&
              typeof (p as { text?: unknown }).text === "string",
          )
          .map((p) => p.text)
          .join("");
      }
      return "";
    };

    const out: ModelMessage[] = [];
    let buf: string[] = [];
    let pending = false;
    const flush = (): void => {
      if (pending) {
        out.push({ role: "assistant", content: buf.join("") });
        buf = [];
        pending = false;
      }
    };

    for (const m of this.messages) {
      if (m.role === "user") {
        flush();
        out.push(m);
      } else if (m.role === "assistant") {
        pending = true;
        const t = extractText(m.content);
        if (t) buf.push(t);
      }
    }
    flush();
    return out;
  }

  private broadcast(): void {
    this.webContents.send("chat-messages-updated", this.displayMessages());
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

    this.messages.push({ role: "user", content: req.message });
    this.broadcast();

    const written = await this.persistAttachments(req);
    const llmText = this.composeUserText(req.message, written);
    const llmContent = await this.buildUserContent(req, llmText);
    const llmMessages: ModelMessage[] = [
      ...this.messages.slice(0, -1),
      {
        role: "user",
        content: llmContent.length === 1 ? llmText : llmContent,
      },
    ];

    const agent = createBrowserAgent({
      model: this.model,
      maxSteps: 50,
      url: this.window?.activeTab?.url,
      temperature: 0.7,
      getTab: () => this.window?.activeTab,
    });

    const placeholderIdx = this.messages.length;
    this.messages.push({ role: "assistant", content: "" });
    let acc = "";

    try {
      const { responseMessages } = await streamAgent(agent, llmMessages, {
        onTextDelta: (chunk) => {
          acc += chunk;
          this.messages[placeholderIdx] = { role: "assistant", content: acc };
          this.broadcast();
          this.streamChunk(req.messageId, chunk, false);
        },
        onToolCallStart: (e) =>
          this.toolEvent("tool-call", req.messageId, {
            toolCallId: e.toolCallId,
            toolName: e.toolName,
            args: undefined,
          }),
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
      this.messages.splice(placeholderIdx, 1, ...responseMessages);
      this.broadcast();
      this.streamChunk(req.messageId, acc, true);
    } catch (e) {
      console.error("[LLMClient] stream error:", e);
      this.streamChunk(req.messageId, this.errorMessage(e), true);
    }
  }

  private async buildUserContent(
    req: ChatRequest,
    text: string,
  ): Promise<UserContent> {
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
    content.push({ type: "text", text });
    return content;
  }

  private async persistAttachments(
    req: ChatRequest,
  ): Promise<{ path: string; mime: string; size: number }[]> {
    const nonImages = (req.attachments ?? []).filter(
      (a) => !a.mime.startsWith("image/"),
    );
    if (nonImages.length === 0) return [];
    const written: { path: string; mime: string; size: number }[] = [];
    for (const a of nonImages) {
      const safeName = a.name.replace(/[^\w.-]/g, "_");
      const path = `/work/${safeName}`;
      try {
        const buf = Buffer.from(a.base64, "base64");
        const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        await executeSandbox((sb) => sb.writeFile(path, data));
        written.push({ path, mime: a.mime, size: a.size });
      } catch (e) {
        console.error(`Failed to persist attachment ${a.name}:`, e);
      }
    }
    return written;
  }

  private composeUserText(
    original: string,
    written: { path: string; mime: string; size: number }[],
  ): string {
    if (written.length === 0) return original;
    const lines = written
      .map((w) => `- ${w.path} (${w.mime}, ${w.size} bytes)`)
      .join("\n");
    const note = `\n\n[Files attached, written to sandbox /work/:\n${lines}\nUse the read_file or bash tools to access them.]`;
    return original ? `${original}${note}` : note.trimStart();
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
