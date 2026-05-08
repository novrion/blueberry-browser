import React, { useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";

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

export const AssistantMessage: React.FC<{
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
