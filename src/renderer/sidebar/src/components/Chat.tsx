import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import {
  ArrowUp,
  Plus,
  ChevronRight,
  Terminal,
  Paperclip,
  X,
} from "lucide-react";
import {
  useChat,
  type ToolCall,
  type SendAttachment,
} from "../contexts/ChatContext";
import { cn } from "@common/lib/utils";
import { Button } from "@common/components/Button";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

// Auto-scroll hook
const useAutoScroll = (
  messages: Message[],
): React.RefObject<HTMLDivElement | null> => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);

  useLayoutEffect(() => {
    if (messages.length > prevCount.current) {
      setTimeout(() => {
        scrollRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      }, 100);
    }
    prevCount.current = messages.length;
  }, [messages.length]);

  return scrollRef;
};

// User Message Component - appears on the right
const UserMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="relative max-w-[85%] ml-auto animate-fade-in">
    <div className="bg-muted dark:bg-muted/50 rounded-3xl px-6 py-4">
      <div className="text-foreground" style={{ whiteSpace: "pre-wrap" }}>
        {content}
      </div>
    </div>
  </div>
);

// Streaming Text Component
const StreamingText: React.FC<{ content: string }> = ({ content }) => {
  const [displayedContent, setDisplayedContent] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < content.length) {
      const timer = setTimeout(() => {
        setDisplayedContent(content.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }, 10);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [content, currentIndex]);

  return (
    <div className="whitespace-pre-wrap text-foreground">
      {displayedContent}
      {currentIndex < content.length && (
        <span className="inline-block w-2 h-5 bg-primary/60 dark:bg-primary/40 ml-0.5 animate-pulse" />
      )}
    </div>
  );
};

// Markdown Renderer Component
const Markdown: React.FC<{ content: string }> = ({ content }) => (
  <div
    className="prose prose-sm dark:prose-invert max-w-none 
                    prose-headings:text-foreground prose-p:text-foreground 
                    prose-strong:text-foreground prose-ul:text-foreground 
                    prose-ol:text-foreground prose-li:text-foreground
                    prose-a:text-primary hover:prose-a:underline
                    prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 
                    prose-code:rounded prose-code:text-sm prose-code:text-foreground
                    prose-pre:bg-muted dark:prose-pre:bg-muted/50 prose-pre:p-3 
                    prose-pre:rounded-lg prose-pre:overflow-x-auto"
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        // Custom code block styling
        code: ({ className, children, ...props }) => {
          const inline = !className;
          return inline ? (
            <code
              className="bg-muted dark:bg-muted/50 px-1 py-0.5 rounded text-sm text-foreground"
              {...props}
            >
              {children}
            </code>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        // Custom link styling
        a: ({ children, href }) => (
          <a
            href={href}
            className="text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

// Tool Call Card — collapsible, shows args + stdout/stderr + result
const ToolCallCard: React.FC<{ call: ToolCall }> = ({ call }) => {
  const [open, setOpen] = useState(true);
  const argsStr = (() => {
    try {
      return JSON.stringify(call.args, null, 2);
    } catch {
      return String(call.args);
    }
  })();
  const code =
    typeof call.args === "object" && call.args !== null && "code" in call.args
      ? ((call.args as { code: unknown }).code as string | undefined)
      : undefined;

  return (
    <div className="my-2 border border-border rounded-lg bg-muted/30 dark:bg-muted/20 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors text-left"
      >
        <ChevronRight
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        <Terminal className="size-3.5" />
        <span className="text-xs font-mono font-semibold">{call.toolName}</span>
        <span className="text-xs text-muted-foreground ml-auto">
          {!call.isComplete ? "running…" : call.isError ? "error" : "done"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2 text-xs font-mono">
          {code !== undefined ? (
            <div>
              <div className="text-muted-foreground mb-1">code</div>
              <pre className="bg-background dark:bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {code}
              </pre>
            </div>
          ) : (
            <div>
              <div className="text-muted-foreground mb-1">args</div>
              <pre className="bg-background dark:bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {argsStr}
              </pre>
            </div>
          )}
          {call.stdout && (
            <div>
              <div className="text-muted-foreground mb-1">stdout</div>
              <pre className="bg-background dark:bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {call.stdout}
              </pre>
            </div>
          )}
          {call.stderr && (
            <div>
              <div className="text-red-500 mb-1">stderr</div>
              <pre className="bg-background dark:bg-secondary border border-red-500/30 rounded p-2 overflow-x-auto whitespace-pre-wrap text-red-500">
                {call.stderr}
              </pre>
            </div>
          )}
          {call.isComplete && call.result !== undefined && (
            <div>
              <div className="text-muted-foreground mb-1">result</div>
              <pre className="bg-background dark:bg-secondary border border-border rounded p-2 overflow-x-auto whitespace-pre-wrap">
                {(() => {
                  try {
                    return JSON.stringify(call.result, null, 2);
                  } catch {
                    return String(call.result);
                  }
                })()}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// Assistant Message Component - appears on the left
const AssistantMessage: React.FC<{
  content: string;
  isStreaming?: boolean;
}> = ({ content, isStreaming }) => (
  <div className="relative w-full animate-fade-in">
    <div className="py-1">
      {isStreaming ? (
        <StreamingText content={content} />
      ) : (
        <Markdown content={content} />
      )}
    </div>
  </div>
);

// Loading Indicator with spinning star
const LoadingIndicator: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div
      className={cn(
        "transition-transform duration-300 ease-in-out",
        isVisible ? "scale-100" : "scale-0",
      )}
    >
      ...
    </div>
  );
};

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_FILES = 10;

function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

async function fileToAttachment(file: File): Promise<SendAttachment> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // chunked base64 to avoid call-stack on large files
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return {
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    base64: btoa(binary),
  };
}

// Chat Input Component with pill design
const ChatInput: React.FC<{
  onSend: (message: string, attachments: SendAttachment[]) => void;
  disabled: boolean;
}> = ({ onSend, disabled }) => {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [attachments, setAttachments] = useState<SendAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.min(scrollHeight, 200); // Max 200px
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value]);

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files);
    const accepted: SendAttachment[] = [];
    for (const f of list) {
      if (attachments.length + accepted.length >= MAX_FILES) {
        console.warn(`File limit reached (${MAX_FILES})`);
        break;
      }
      if (f.size > MAX_FILE_BYTES) {
        console.warn(`Skipping ${f.name}: exceeds ${MAX_FILE_BYTES} bytes`);
        continue;
      }
      try {
        accepted.push(await fileToAttachment(f));
      } catch (err) {
        console.error(`Failed to read ${f.name}:`, err);
      }
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
  };

  const removeAttachment = (idx: number): void => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (): void => {
    const canSend = !disabled && (value.trim() || attachments.length > 0);
    if (!canSend) return;
    onSend(value.trim(), attachments);
    setValue("");
    setAttachments([]);
    if (textareaRef.current) textareaRef.current.style.height = "24px";
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleDrop = (e: React.DragEvent): void => {
    e.preventDefault();
    setIsDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      addFiles(e.dataTransfer.files);
    }
  };

  const handlePaste = (e: React.ClipboardEvent): void => {
    if (e.clipboardData.files.length > 0) {
      e.preventDefault();
      addFiles(e.clipboardData.files);
    }
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={cn(
        "w-full border p-3 rounded-3xl bg-background dark:bg-secondary",
        "shadow-chat animate-spring-scale outline-none transition-all duration-200",
        isDragOver
          ? "border-primary border-dashed"
          : isFocused
            ? "border-primary/20 dark:border-primary/30"
            : "border-border",
      )}
    >
      {/* Attachment chips */}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-3 pt-1 pb-2">
          {attachments.map((a, i) => (
            <div
              key={`${a.name}-${i}`}
              className="flex items-center gap-1.5 bg-muted dark:bg-muted/50 rounded-md px-2 py-1 text-xs"
            >
              <Paperclip className="size-3" />
              <span className="font-mono truncate max-w-[160px]">{a.name}</span>
              <span className="text-muted-foreground">
                {formatBytes(a.size)}
              </span>
              <button
                onClick={() => removeAttachment(i)}
                className="hover:bg-background dark:hover:bg-secondary rounded p-0.5"
                aria-label={`Remove ${a.name}`}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Input Area */}
      <div className="w-full px-3 py-2">
        <div className="w-full flex items-start gap-3">
          <div className="relative flex-1 overflow-hidden">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>): void =>
                setValue(e.target.value)
              }
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={
                isDragOver ? "Drop files to attach…" : "Send a message..."
              }
              className="w-full resize-none outline-none bg-transparent
                                     text-foreground placeholder:text-muted-foreground
                                     min-h-[24px] max-h-[200px]"
              rows={1}
              style={{ lineHeight: "24px" }}
            />
          </div>
        </div>
      </div>

      {/* Bottom row: attach button + send button */}
      <div className="w-full flex items-center gap-1.5 px-1 mt-2 mb-1">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e: React.ChangeEvent<HTMLInputElement>): void => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || attachments.length >= MAX_FILES}
          aria-label="Attach files"
          className={cn(
            "size-9 rounded-full flex items-center justify-center",
            "text-muted-foreground hover:text-foreground hover:bg-muted",
            "transition-colors duration-200 disabled:opacity-50",
          )}
        >
          <Paperclip className="size-4" />
        </button>
        <div className="flex-1" />
        <button
          onClick={handleSubmit}
          disabled={disabled || (!value.trim() && attachments.length === 0)}
          className={cn(
            "size-9 rounded-full flex items-center justify-center",
            "transition-all duration-200",
            "bg-primary text-primary-foreground",
            "hover:opacity-80 disabled:opacity-50",
          )}
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
    </div>
  );
};

// Conversation Turn Component
interface ConversationTurn {
  user?: Message;
  assistant?: Message;
}

const ConversationTurnComponent: React.FC<{
  turn: ConversationTurn;
  isLoading?: boolean;
  toolCalls?: ToolCall[];
}> = ({ turn, isLoading, toolCalls }) => (
  <div className="pt-12 flex flex-col gap-4">
    {turn.user && <UserMessage content={turn.user.content} />}
    {toolCalls && toolCalls.length > 0 && (
      <div className="flex flex-col">
        {toolCalls.map((c) => (
          <ToolCallCard key={c.toolCallId} call={c} />
        ))}
      </div>
    )}
    {turn.assistant && (
      <AssistantMessage
        content={turn.assistant.content}
        isStreaming={turn.assistant.isStreaming}
      />
    )}
    {isLoading && (
      <div className="flex justify-start">
        <LoadingIndicator />
      </div>
    )}
  </div>
);

// Main Chat Component
export const Chat: React.FC = () => {
  const {
    messages,
    isLoading,
    sendMessage,
    clearChat,
    toolCallsByMessage,
    activeMessageId,
  } = useChat();
  const scrollRef = useAutoScroll(messages);

  // Group messages into conversation turns
  const conversationTurns: ConversationTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      const turn: ConversationTurn = { user: messages[i] };
      if (messages[i + 1]?.role === "assistant") {
        turn.assistant = messages[i + 1];
        i++; // Skip next message since we've paired it
      }
      conversationTurns.push(turn);
    } else if (
      messages[i].role === "assistant" &&
      (i === 0 || messages[i - 1]?.role !== "user")
    ) {
      // Handle standalone assistant messages
      conversationTurns.push({ assistant: messages[i] });
    }
  }

  // Check if we need to show loading after the last turn
  const showLoadingAfterLastTurn =
    isLoading && messages[messages.length - 1]?.role === "user";

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="h-8 max-w-3xl mx-auto px-4">
          {/* New Chat Button - Floating */}
          {messages.length > 0 && (
            <Button onClick={clearChat} title="Start new chat" variant="ghost">
              <Plus className="size-4" />
              New Chat
            </Button>
          )}
        </div>

        <div className="pb-4 relative max-w-3xl mx-auto px-4">
          {messages.length === 0 ? (
            // Empty State
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center animate-fade-in max-w-md mx-auto gap-2 flex flex-col">
                <h3 className="text-2xl font-bold">🫐</h3>
                <p className="text-muted-foreground text-sm">
                  Press ⌘E to toggle the sidebar
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Render conversation turns */}
              {conversationTurns.map((turn, index) => {
                const isLast = index === conversationTurns.length - 1;
                const calls =
                  isLast && activeMessageId
                    ? toolCallsByMessage[activeMessageId]
                    : undefined;
                return (
                  <ConversationTurnComponent
                    key={`turn-${index}`}
                    turn={turn}
                    toolCalls={calls}
                    isLoading={showLoadingAfterLastTurn && isLast}
                  />
                );
              })}
            </>
          )}

          {/* Scroll anchor */}
          <div ref={scrollRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4">
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </div>
    </div>
  );
};
