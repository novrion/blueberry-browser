import type { SendAttachment } from "../contexts/ChatContext";

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ConversationTurn {
  user?: Message;
  assistant?: Message;
  attachments?: SendAttachment[];
}
