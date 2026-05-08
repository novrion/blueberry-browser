import type { SendAttachment } from "../../contexts/ChatContext";

export const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
export const MAX_FILES = 10;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

export async function fileToAttachment(file: File): Promise<SendAttachment> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return {
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
    base64: btoa(binary),
  };
}
