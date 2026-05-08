import React from "react";
import { FileText, FileImage, FileCode, File } from "lucide-react";
import { type SendAttachment } from "../../contexts/ChatContext";
import { formatBytes } from "../../lib/attachments";

const iconFor = (mime: string): React.ComponentType<{ className?: string }> => {
  if (mime.startsWith("image/")) return FileImage;
  if (mime.startsWith("text/")) return FileText;
  if (
    mime.includes("json") ||
    mime.includes("javascript") ||
    mime.includes("typescript") ||
    mime.includes("xml")
  )
    return FileCode;
  return File;
};

const AttachmentChip: React.FC<{ attachment: SendAttachment }> = ({
  attachment,
}) => {
  const Icon = iconFor(attachment.mime);
  return (
    <div
      className="group flex items-center gap-2 bg-background dark:bg-secondary
                 border border-border/60 rounded-xl pl-2 pr-3 py-1.5
                 shadow-sm hover:border-border transition-colors max-w-[220px]"
    >
      <div className="flex items-center justify-center size-7 rounded-lg bg-muted dark:bg-muted/60 shrink-0">
        <Icon className="size-3.5 text-muted-foreground" />
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-foreground truncate leading-tight">
          {attachment.name}
        </span>
        <span className="text-[10px] text-muted-foreground leading-tight">
          {formatBytes(attachment.size)}
        </span>
      </div>
    </div>
  );
};

export const UserMessage: React.FC<{
  content: string;
  attachments?: SendAttachment[];
}> = ({ content, attachments }) => {
  const hasAttachments = attachments && attachments.length > 0;
  const hasContent = content && content.length > 0;
  if (!hasAttachments && !hasContent) return null;

  return (
    <div className="relative max-w-[85%] ml-auto animate-fade-in flex flex-col items-end gap-1.5">
      {hasAttachments && (
        <div className="flex flex-wrap gap-1.5 justify-end">
          {attachments.map((a, i) => (
            <AttachmentChip key={`${a.name}-${i}`} attachment={a} />
          ))}
        </div>
      )}
      {hasContent && (
        <div className="bg-muted dark:bg-muted/50 rounded-3xl px-6 py-4">
          <div className="text-foreground" style={{ whiteSpace: "pre-wrap" }}>
            {content}
          </div>
        </div>
      )}
    </div>
  );
};
