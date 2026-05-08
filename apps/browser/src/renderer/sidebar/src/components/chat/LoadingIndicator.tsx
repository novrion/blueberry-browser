import React from "react";
import { Brain } from "lucide-react";

export const LoadingIndicator: React.FC = () => (
  <div className="flex items-center gap-2 animate-fade-in">
    <Brain className="size-4 text-muted-foreground animate-pulse" />
    <span
      className="text-sm font-medium bg-clip-text text-transparent bg-[length:200%_100%] animate-shimmer
                 bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground"
    >
      Thinking...
    </span>
  </div>
);
