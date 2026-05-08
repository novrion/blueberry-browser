import { ElectronAPI } from "@electron-toolkit/preload";

interface Attachment {
  name: string;
  mime: string;
  size: number;
  base64: string;
}

interface ChatRequest {
  message: string;
  context: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
  attachments?: Attachment[];
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface ToolProgress {
  type: "stdout" | "stderr" | "info";
  data: string;
}

type AgentToolEvent =
  | {
      kind: "tool-call";
      messageId: string;
      toolCallId: string;
      toolName: string;
      args: unknown;
    }
  | {
      kind: "tool-progress";
      messageId: string;
      toolCallId: string;
      progress: ToolProgress;
    }
  | {
      kind: "tool-result";
      messageId: string;
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
    };

interface StoredMessage {
  role: "user" | "assistant" | "system" | "tool";
  content:
    | string
    | Array<{
        type: string;
        text?: string;
        image?: string;
        [k: string]: unknown;
      }>;
}

interface SidebarAPI {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) => Promise<void>;
  clearChat: () => Promise<boolean>;
  getMessages: () => Promise<StoredMessage[]>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  onMessagesUpdated: (callback: (messages: StoredMessage[]) => void) => void;
  onAgentToolEvent: (callback: (event: AgentToolEvent) => void) => void;
  removeChatResponseListener: () => void;
  removeMessagesUpdatedListener: () => void;
  removeAgentToolEventListener: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  // Tab information
  getActiveTabInfo: () => Promise<TabInfo | null>;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}
