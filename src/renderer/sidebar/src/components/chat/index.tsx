import React from "react";
import { Plus } from "lucide-react";
import { useChat } from "../../contexts/ChatContext";
import { Button } from "@common/components/Button";
import { useAutoScroll } from "../../hooks/useAutoScroll";
import { ConversationTurnComponent } from "./ConversationTurn";
import { ChatInput } from "./ChatInput";
import type { ConversationTurn } from "../../types/chat";

export const Chat: React.FC = () => {
  const {
    messages,
    isLoading,
    sendMessage,
    clearChat,
    toolCallsByMessage,
    activeMessageId,
    userAttachments,
  } = useChat();
  const scrollRef = useAutoScroll(messages);

  const conversationTurns: ConversationTurn[] = [];
  let userIdx = 0;
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      const turn: ConversationTurn = {
        user: messages[i],
        attachments: userAttachments[userIdx],
      };
      userIdx++;
      if (messages[i + 1]?.role === "assistant") {
        turn.assistant = messages[i + 1];
        i++;
      }
      conversationTurns.push(turn);
    } else if (
      messages[i].role === "assistant" &&
      (i === 0 || messages[i - 1]?.role !== "user")
    ) {
      conversationTurns.push({ assistant: messages[i] });
    }
  }

  const showLoadingAfterLastTurn =
    isLoading && messages[messages.length - 1]?.role === "user";

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="flex-1 overflow-y-auto">
        <div className="h-8 max-w-3xl mx-auto px-4">
          {messages.length > 0 && (
            <Button onClick={clearChat} title="Start new chat" variant="ghost">
              <Plus className="size-4" />
              New Chat
            </Button>
          )}
        </div>

        <div className="pb-4 relative max-w-3xl mx-auto px-4">
          {messages.length === 0 ? (
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
                    attachments={turn.attachments}
                    toolCalls={calls}
                    isLoading={showLoadingAfterLastTurn && isLast}
                  />
                );
              })}
            </>
          )}

          <div ref={scrollRef} />
        </div>
      </div>

      <div className="p-4">
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </div>
    </div>
  );
};
