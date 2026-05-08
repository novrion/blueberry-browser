import React from "react";

export const UserMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="relative max-w-[85%] ml-auto animate-fade-in">
    <div className="bg-muted dark:bg-muted/50 rounded-3xl px-6 py-4">
      <div className="text-foreground" style={{ whiteSpace: "pre-wrap" }}>
        {content}
      </div>
    </div>
  </div>
);
