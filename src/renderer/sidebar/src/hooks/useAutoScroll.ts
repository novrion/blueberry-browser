import React, { useRef, useLayoutEffect } from "react";
import type { Message } from "../types/chat";

export const useAutoScroll = (
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
