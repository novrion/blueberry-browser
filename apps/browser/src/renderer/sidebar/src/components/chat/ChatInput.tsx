import React, { useState, useRef, useEffect } from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { type SendAttachment } from "../../contexts/ChatContext";
import { cn } from "@common/lib/utils";
import {
  MAX_FILE_BYTES,
  MAX_FILES,
  formatBytes,
  fileToAttachment,
} from "../../lib/attachments";

export const ChatInput: React.FC<{
  onSend: (message: string, attachments: SendAttachment[]) => void;
  disabled: boolean;
}> = ({ onSend, disabled }) => {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const [attachments, setAttachments] = useState<SendAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.min(scrollHeight, 200);
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
