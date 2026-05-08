import type { LanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";

export type Provider = "openai" | "anthropic" | "google";

const DEFAULT_MODELS: Record<Provider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-sonnet-20241022",
  google: "gemini-3-flash-preview",
};

function selectProvider(): Provider {
  const p = process.env.LLM_PROVIDER?.toLowerCase();
  if (p === "anthropic") return "anthropic";
  if (p === "google" || p === "gemini") return "google";
  return "openai";
}

function getApiKey(provider: Provider): string | undefined {
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  if (provider === "google") return process.env.GEMINI_API_KEY;
  return process.env.OPENAI_API_KEY;
}

export function selectModel(): LanguageModel | null {
  if (process.env.GEMINI_API_KEY) {
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GEMINI_API_KEY;
  }
  const provider = selectProvider();
  if (!getApiKey(provider)) return null;
  const name = process.env.LLM_MODEL || DEFAULT_MODELS[provider];
  switch (provider) {
    case "anthropic":
      return anthropic(name);
    case "google":
      return google(name);
    default:
      return openai(name);
  }
}
