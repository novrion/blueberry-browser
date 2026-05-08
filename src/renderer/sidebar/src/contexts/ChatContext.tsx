import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from "react";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: unknown;
  stdout: string;
  stderr: string;
  result?: unknown;
  isError?: boolean;
  isComplete: boolean;
}

interface StoredMessageLike {
  role: "user" | "assistant" | "system" | "tool";
  content:
    | string
    | Array<{ type: string; text?: string; [k: string]: unknown }>;
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
      progress: { type: "stdout" | "stderr" | "info"; data: string };
    }
  | {
      kind: "tool-result";
      messageId: string;
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError?: boolean;
    };

export interface SendAttachment {
  name: string;
  mime: string;
  size: number;
  base64: string;
}

interface ChatContextType {
  messages: Message[];
  isLoading: boolean;
  toolCallsByMessage: Record<string, ToolCall[]>;
  activeMessageId: string | null;

  sendMessage: (
    content: string,
    attachments?: SendAttachment[],
  ) => Promise<void>;
  clearChat: () => Promise<void>;

  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;
}

const ChatContext = createContext<ChatContextType | null>(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useChat = (): ChatContextType => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error("useChat must be used within a ChatProvider");
  }
  return context;
};

function convertStoredMessage(msg: StoredMessageLike, index: number): Message {
  const role: Message["role"] = msg.role === "assistant" ? "assistant" : "user";
  const content =
    typeof msg.content === "string"
      ? msg.content
      : (msg.content.find((p) => p.type === "text")?.text ?? "");
  return {
    id: `msg-${index}`,
    role,
    content,
    timestamp: Date.now(),
    isStreaming: false,
  };
}

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [toolCallsByMessage, setToolCallsByMessage] = useState<
    Record<string, ToolCall[]>
  >({});
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
  const activeMessageIdRef = useRef<string | null>(null);

  const setActive = (id: string | null): void => {
    activeMessageIdRef.current = id;
    setActiveMessageId(id);
  };

  useEffect(() => {
    const loadMessages = async (): Promise<void> => {
      try {
        const stored = await window.sidebarAPI.getMessages();
        if (stored && stored.length > 0) {
          setMessages(stored.map(convertStoredMessage));
        }
      } catch (error) {
        console.error("Failed to load messages:", error);
      }
    };
    loadMessages();
  }, []);

  const sendMessage = useCallback(
    async (content: string, attachments?: SendAttachment[]): Promise<void> => {
      setIsLoading(true);
      try {
        const messageId = Date.now().toString();
        setActive(messageId);
        await window.sidebarAPI.sendChatMessage({
          message: content,
          messageId,
          attachments,
        });
      } catch (error) {
        console.error("Failed to send message:", error);
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const clearChat = useCallback(async (): Promise<void> => {
    try {
      await window.sidebarAPI.clearChat();
      setMessages([]);
      setToolCallsByMessage({});
      setActive(null);
    } catch (error) {
      console.error("Failed to clear chat:", error);
    }
  }, []);

  const getPageContent = useCallback(async (): Promise<string | null> => {
    try {
      return await window.sidebarAPI.getPageContent();
    } catch {
      return null;
    }
  }, []);
  const getPageText = useCallback(async (): Promise<string | null> => {
    try {
      return await window.sidebarAPI.getPageText();
    } catch {
      return null;
    }
  }, []);
  const getCurrentUrl = useCallback(async (): Promise<string | null> => {
    try {
      return await window.sidebarAPI.getCurrentUrl();
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const handleChatResponse = (data: {
      messageId: string;
      content: string;
      isComplete: boolean;
    }): void => {
      if (data.isComplete) {
        setIsLoading(false);
      }
    };

    const handleMessagesUpdated = (
      updatedMessages: StoredMessageLike[],
    ): void => {
      setMessages(updatedMessages.map(convertStoredMessage));
    };

    const handleAgentToolEvent = (event: AgentToolEvent): void => {
      const msgId = event.messageId;
      if (!msgId) return;
      setToolCallsByMessage((prev) => {
        const list = prev[msgId] ? [...prev[msgId]] : [];
        const idx = list.findIndex((c) => c.toolCallId === event.toolCallId);

        if (event.kind === "tool-call") {
          if (idx === -1) {
            list.push({
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args,
              stdout: "",
              stderr: "",
              isComplete: false,
            });
          }
        } else if (event.kind === "tool-progress" && idx !== -1) {
          const cur = list[idx];
          list[idx] = {
            ...cur,
            stdout:
              event.progress.type === "stdout"
                ? cur.stdout + event.progress.data
                : cur.stdout,
            stderr:
              event.progress.type === "stderr"
                ? cur.stderr + event.progress.data
                : cur.stderr,
          };
        } else if (event.kind === "tool-result" && idx !== -1) {
          list[idx] = {
            ...list[idx],
            result: event.result,
            isError: event.isError,
            isComplete: true,
          };
        }
        return { ...prev, [msgId]: list };
      });
    };

    window.sidebarAPI.onChatResponse(handleChatResponse);
    window.sidebarAPI.onMessagesUpdated(handleMessagesUpdated);
    window.sidebarAPI.onAgentToolEvent(handleAgentToolEvent);

    return () => {
      window.sidebarAPI.removeChatResponseListener();
      window.sidebarAPI.removeMessagesUpdatedListener();
      window.sidebarAPI.removeAgentToolEventListener();
    };
  }, []);

  const value: ChatContextType = {
    messages,
    isLoading,
    toolCallsByMessage,
    activeMessageId,
    sendMessage,
    clearChat,
    getPageContent,
    getPageText,
    getCurrentUrl,
  };

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
};
