import React from "react";
import { type ToolCall, type SendAttachment } from "../../contexts/ChatContext";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ToolCallCard } from "./ToolCallCard";
import { ToolsSummary } from "./ToolsSummary";
import { LoadingIndicator } from "./LoadingIndicator";
import type { ConversationTurn } from "../../types/chat";

export const ConversationTurnComponent: React.FC<{
  turn: ConversationTurn;
  isLoading?: boolean;
  toolCalls?: ToolCall[];
  attachments?: SendAttachment[];
}> = ({ turn, isLoading, toolCalls, attachments }) => (
  <div className="pt-8 flex flex-col gap-2">
    {turn.user && (
      <UserMessage content={turn.user.content} attachments={attachments} />
    )}
    {isLoading && (
      <div className="flex justify-start">
        <LoadingIndicator />
      </div>
    )}
    {toolCalls && toolCalls.length > 0 && (
      <div className="flex flex-col">
        {toolCalls.map((c) => (
          <ToolCallCard key={c.toolCallId} call={c} />
        ))}
      </div>
    )}
    {turn.assistant && (
      <div className="flex flex-col">
        {toolCalls && toolCalls.length > 0 && (
          <ToolsSummary calls={toolCalls} />
        )}
        <AssistantMessage
          content={turn.assistant.content}
          isStreaming={turn.assistant.isStreaming}
        />
      </div>
    )}
  </div>
);
