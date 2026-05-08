import { WebContents } from "electron";
import type { LanguageModel, ModelMessage, UserContent } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import { ToolRegistry, runAgent } from "@blueberry/agent-core";
import {
  E2BSandboxProvider,
  SandboxManager,
  createPythonTool,
  createBashTool,
  createReadFileTool,
  createWriteFileTool,
} from "@blueberry/tools-sandbox";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

// `@ai-sdk/google` reads GOOGLE_GENERATIVE_AI_API_KEY internally.
// Forward GEMINI_API_KEY into it so callers only need to set GEMINI_API_KEY.
if (process.env.GEMINI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
}

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

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

type LLMProvider = "openai" | "anthropic" | "google";

const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  google: "gemini-3-flash-preview",
};

const MAX_CONTEXT_LENGTH = 4000;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_SESSION_ID = "default";

let sharedSandboxManager: SandboxManager | null = null;

function getOrInitSandboxManager(): SandboxManager | null {
  if (sharedSandboxManager) return sharedSandboxManager;
  const apiKey = process.env.E2B_API_KEY;
  if (!apiKey) {
    console.warn(
      "⚠️  E2B_API_KEY not set — python tool disabled. Add E2B_API_KEY to .env to enable code execution.",
    );
    return null;
  }
  sharedSandboxManager = new SandboxManager({
    provider: new E2BSandboxProvider({ apiKey }),
    idleTimeoutMs: 10 * 60 * 1000,
  });
  return sharedSandboxManager;
}

export function shutdownSandboxManager(): Promise<void> {
  if (!sharedSandboxManager) return Promise.resolve();
  const m = sharedSandboxManager;
  sharedSandboxManager = null;
  return m.killAll();
}

export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly provider: LLMProvider;
  private readonly modelName: string;
  private readonly model: LanguageModel | null;
  private readonly registry: ToolRegistry;
  private messages: ModelMessage[] = [];

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    this.provider = this.getProvider();
    this.modelName = this.getModelName();
    this.model = this.initializeModel();
    this.registry = this.buildToolRegistry();

    this.logInitializationStatus();
  }

  setWindow(window: Window): void {
    this.window = window;
  }

  private getProvider(): LLMProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    if (provider === "google" || provider === "gemini") return "google";
    return "openai";
  }

  private getModelName(): string {
    return process.env.LLM_MODEL || DEFAULT_MODELS[this.provider];
  }

  private initializeModel(): LanguageModel | null {
    const apiKey = this.getApiKey();
    if (!apiKey) return null;

    switch (this.provider) {
      case "anthropic":
        return anthropic(this.modelName);
      case "openai":
        return openai(this.modelName);
      case "google":
        return google(this.modelName);
      default:
        return null;
    }
  }

  private getApiKey(): string | undefined {
    switch (this.provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      case "google":
        return process.env.GEMINI_API_KEY;
      default:
        return undefined;
    }
  }

  private buildToolRegistry(): ToolRegistry {
    const registry = new ToolRegistry();
    const manager = getOrInitSandboxManager();
    if (manager) {
      registry.register(createPythonTool(manager));
      registry.register(createBashTool(manager));
      registry.register(createReadFileTool(manager));
      registry.register(createWriteFileTool(manager));
    }
    return registry;
  }

  private logInitializationStatus(): void {
    if (this.model) {
      const tools =
        this.registry
          .list()
          .map((t) => t.name)
          .join(", ") || "none";
      console.log(
        `✅ LLM Client initialized with ${this.provider} provider using model: ${this.modelName}. Tools: ${tools}`,
      );
    } else {
      const keyName =
        this.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "OPENAI_API_KEY";
      console.error(
        `❌ LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`,
      );
    }
  }

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      let screenshot: string | null = null;
      if (this.window) {
        const activeTab = this.window.activeTab;
        if (activeTab) {
          try {
            const image = await activeTab.screenshot();
            screenshot = image.toDataURL();
          } catch (error) {
            console.error("Failed to capture screenshot:", error);
          }
        }
      }

      const writtenFiles = await this.persistAttachmentsToSandbox(
        request.attachments,
      );

      const userContent: UserContent = [];
      if (screenshot) {
        userContent.push({ type: "image", image: screenshot });
      }

      // Inline image attachments so the LLM can see them directly.
      if (request.attachments) {
        for (const a of request.attachments) {
          if (a.mime.startsWith("image/")) {
            userContent.push({
              type: "image",
              image: `data:${a.mime};base64,${a.base64}`,
            });
          }
        }
      }

      const messageText = this.composeUserText(request.message, writtenFiles);
      userContent.push({ type: "text", text: messageText });

      const userMessage: ModelMessage = {
        role: "user",
        content: userContent.length === 1 ? messageText : userContent,
      };

      this.messages.push(userMessage);
      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          request.messageId,
          "LLM service is not configured. Please add your API key to the .env file.",
        );
        return;
      }

      const messages = await this.prepareMessagesWithContext();
      await this.runAgentLoop(messages, request.messageId);
    } catch (error) {
      console.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  private composeUserText(
    original: string,
    written: { path: string; size: number; mime: string }[],
  ): string {
    if (written.length === 0) return original;
    const lines = written
      .map((w) => `- ${w.path} (${w.mime}, ${w.size} bytes)`)
      .join("\n");
    const note = `\n\n[Attached files written to the sandbox /work/ directory:\n${lines}\nUse the read_file or bash tools to access them.]`;
    return original ? `${original}${note}` : note.trimStart();
  }

  private async persistAttachmentsToSandbox(
    attachments: Attachment[] | undefined,
  ): Promise<{ path: string; size: number; mime: string }[]> {
    if (!attachments || attachments.length === 0) return [];
    const manager = getOrInitSandboxManager();
    if (!manager) {
      console.warn(
        "Attachments received but no sandbox available — files will only be referenced by name.",
      );
      return attachments.map((a) => ({
        path: `/work/${a.name}`,
        size: a.size,
        mime: a.mime,
      }));
    }
    const sb = await manager.getOrCreate(DEFAULT_SESSION_ID);
    const written: { path: string; size: number; mime: string }[] = [];
    for (const a of attachments) {
      const safeName = a.name.replace(/[^\w.-]/g, "_");
      const path = `/work/${safeName}`;
      try {
        const buf = Buffer.from(a.base64, "base64");
        await sb.writeFile(
          path,
          new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        );
        written.push({ path, size: a.size, mime: a.mime });
      } catch (err) {
        console.error(`Failed to write attachment ${a.name}:`, err);
      }
    }
    manager.touch(DEFAULT_SESSION_ID);
    return written;
  }

  clearMessages(): void {
    this.messages = [];
    this.sendMessagesToRenderer();
  }

  getMessages(): ModelMessage[] {
    return this.messages;
  }

  private sendMessagesToRenderer(): void {
    this.webContents.send("chat-messages-updated", this.messages);
  }

  private async prepareMessagesWithContext(): Promise<ModelMessage[]> {
    let pageUrl: string | null = null;
    let pageText: string | null = null;

    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        try {
          pageText = await activeTab.getTabText();
        } catch (error) {
          console.error("Failed to get page text:", error);
        }
      }
    }

    const systemMessage: ModelMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText),
    };

    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(
    url: string | null,
    pageText: string | null,
  ): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
    ];

    const toolNames = new Set(this.registry.list().map((t) => t.name));
    if (toolNames.has("python") || toolNames.has("bash")) {
      parts.push(
        "\nYou have a sandboxed Linux microVM available via these tools:",
        toolNames.has("python")
          ? "- `python(code)` runs Python (stdlib + pandas, numpy, etc.)."
          : "",
        toolNames.has("bash")
          ? "- `bash(cmd)` runs shell commands. Use for filesystem ops, package installs, CLIs."
          : "",
        toolNames.has("read_file")
          ? "- `read_file(path)` reads a file from the sandbox."
          : "",
        toolNames.has("write_file")
          ? "- `write_file(path, content)` writes a file in the sandbox."
          : "",
        "The sandbox's `/work` directory persists across calls within this chat session.",
      );
    }

    if (url) parts.push(`\nCurrent page URL: ${url}`);
    if (pageText) {
      parts.push(
        `\nPage content (text):\n${this.truncateText(pageText, MAX_CONTEXT_LENGTH)}`,
      );
    }

    parts.push(
      "\nProvide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided.",
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async runAgentLoop(
    messages: ModelMessage[],
    messageId: string,
  ): Promise<void> {
    if (!this.model) throw new Error("Model not initialized");

    let accumulatedText = "";
    const messageIndex = this.messages.length;
    this.messages.push({ role: "assistant", content: "" });

    const flushAssistant = (): void => {
      this.messages[messageIndex] = {
        role: "assistant",
        content: accumulatedText,
      };
      this.sendMessagesToRenderer();
    };

    const result = await runAgent({
      model: this.model,
      messages,
      registry: this.registry,
      sessionId: DEFAULT_SESSION_ID,
      temperature: DEFAULT_TEMPERATURE,
      maxSteps: 5,
      onTextChunk: (chunk) => {
        accumulatedText += chunk;
        flushAssistant();
        this.sendStreamChunk(messageId, {
          content: chunk,
          isComplete: false,
        });
      },
      onToolCall: (e) => {
        this.webContents.send("agent-tool-event", {
          kind: "tool-call",
          messageId,
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          args: e.args,
        });
      },
      onToolResult: (e) => {
        this.webContents.send("agent-tool-event", {
          kind: "tool-result",
          messageId,
          toolCallId: e.toolCallId,
          toolName: e.toolName,
          result: e.result,
          isError: e.isError,
        });
      },
      onToolProgress: (toolCallId, p) => {
        this.webContents.send("agent-tool-event", {
          kind: "tool-progress",
          messageId,
          toolCallId,
          progress: p,
        });
      },
    });

    if (!accumulatedText) {
      accumulatedText = result.finalText;
      flushAssistant();
    }

    this.sendStreamChunk(messageId, {
      content: accumulatedText,
      isComplete: true,
    });
  }

  private handleStreamError(error: unknown, messageId: string): void {
    console.error("Error streaming from LLM:", error);
    this.sendErrorMessage(messageId, this.getErrorMessage(error));
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }
    const message = error.message.toLowerCase();
    if (message.includes("401") || message.includes("unauthorized")) {
      return "Authentication error: Please check your API key in the .env file.";
    }
    if (message.includes("429") || message.includes("rate limit")) {
      return "Rate limit exceeded. Please try again in a few moments.";
    }
    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused")
    ) {
      return "Network error: Please check your internet connection.";
    }
    if (message.includes("timeout")) {
      return "Request timeout: The service took too long to respond. Please try again.";
    }
    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
    });
  }
}
