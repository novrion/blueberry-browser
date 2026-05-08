import React from "react";
import { type ToolCall } from "../../contexts/ChatContext";
import { UserMessage } from "./UserMessage";
import { AssistantMessage } from "./AssistantMessage";
import { ToolCallCard } from "./ToolCallCard";
import { LoadingIndicator } from "./LoadingIndicator";
import type { ConversationTurn } from "./types";

export const ConversationTurnComponent: React.FC<{
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
