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
    className="text-foreground leading-relaxed
               [&>*+*]:mt-3
               [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mt-5 [&_h1]:mb-2
               [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2
               [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1
               [&_h4]:text-base [&_h4]:font-semibold [&_h4]:mt-3 [&_h4]:mb-1
               [&_p]:leading-relaxed
               [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1
               [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-1
               [&_li]:leading-relaxed [&_li>p]:my-0
               [&_li>ul]:mt-1 [&_li>ol]:mt-1
               [&_strong]:font-semibold [&_em]:italic
               [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground
               [&_hr]:border-border [&_hr]:my-4
               [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1
               [&_pre]:bg-muted/50 [&_pre]:dark:bg-muted/30 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto [&_pre]:text-sm [&_pre]:font-mono
               [&_pre_code]:bg-transparent [&_pre_code]:p-0"
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        code: ({ className, children, ...props }) => {
          const inline = !className;
          return inline ? (
            <code
              className="bg-muted dark:bg-muted/50 px-1.5 py-0.5 rounded text-sm font-mono text-foreground"
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
            className="text-primary underline underline-offset-2 hover:opacity-80"
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
    {isStreaming ? (
      <StreamingText content={content} />
    ) : (
      <Markdown content={content} />
    )}
  </div>
);
