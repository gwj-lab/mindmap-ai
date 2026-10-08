import { contentHash } from "../shared/content.js";
import type { CapturedAnswerPayload } from "../shared/types.js";
import * as chatgpt from "./chatgpt-adapter.js";
import { doubaoAdapter } from "./doubao-adapter.js";
import { yuanbaoAdapter } from "./yuanbao-adapter.js";

function platform(sourceUrl: string): "chatgpt" | "doubao" | "yuanbao" {
  const host = new URL(sourceUrl).hostname;
  if (host === "chatgpt.com") return "chatgpt";
  if (host === "www.doubao.com") return "doubao";
  if (host === "yuanbao.tencent.com") return "yuanbao";
  throw new Error("不支持的问答网站");
}

function adapter(provider: "doubao" | "yuanbao") { return provider === "doubao" ? doubaoAdapter : yuanbaoAdapter; }

export function findAssistantMessage(target: EventTarget | null, sourceUrl = "https://chatgpt.com/"): Element | null {
  let provider: ReturnType<typeof platform>;
  try { provider = platform(sourceUrl); } catch { return null; }
  if (provider === "chatgpt") return chatgpt.findAssistantMessage(target, sourceUrl);
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const message = element?.closest(adapter(provider).messageSelector) ?? null;
  return provider === "doubao" ? message?.closest('[data-testid="receive_message"]') ?? message : message;
}

export function isAssistantMessageStreaming(message: Element, sourceUrl = "https://chatgpt.com/"): boolean {
  const provider = platform(sourceUrl);
  if (provider === "chatgpt") return chatgpt.isAssistantMessageStreaming(message);
  if (message.matches('[data-is-streaming="true"], [data-streaming="true"], [aria-busy="true"]') || message.querySelector('[data-is-streaming="true"], [data-streaming="true"], [aria-busy="true"]')) return true;
  const last = [...message.ownerDocument.querySelectorAll(adapter(provider).messageSelector)].at(-1);
  return Boolean(last && message.contains(last) && message.ownerDocument.querySelector(
    '[data-testid="stop-button"], [data-testid="stop_generate"], [aria-label*="停止回答"], [aria-label*="停止生成"]'
  ));
}

export async function extractSelectedAnswer(content: Element, sourceUrl: string, message: Element = content): Promise<CapturedAnswerPayload> {
  const provider = platform(sourceUrl);
  if (provider === "chatgpt") return chatgpt.extractSelectedAnswer(content, sourceUrl, message);
  const markdown = adapter(provider).toMarkdown(content, sourceUrl);
  if (!markdown.trim()) throw new Error("Selected answer is empty");
  const sourceMessageId = message.getAttribute("data-message-id") || message.querySelector("[data-message-id]")?.getAttribute("data-message-id") || message.querySelector("[data-trace-id]")?.getAttribute("data-trace-id") || message.id || `assistant-${(await contentHash(markdown)).slice(0, 16)}`;
  return { provider, sourceUrl, sourceMessageId, markdown };
}

export async function extractAnswerFromTarget(target: EventTarget | null, sourceUrl: string): Promise<CapturedAnswerPayload | null> {
  const provider = platform(sourceUrl);
  if (provider === "chatgpt") return chatgpt.extractAnswerFromTarget(target, sourceUrl);
  const message = findAssistantMessage(target, sourceUrl);
  if (!message || isAssistantMessageStreaming(message, sourceUrl)) return null;
  return extractSelectedAnswer(adapter(provider).content(message), sourceUrl, message);
}

export async function extractLatestAnswer(documentRef: Document, sourceUrl: string): Promise<CapturedAnswerPayload | null> {
  const provider = platform(sourceUrl);
  if (provider === "chatgpt") return chatgpt.extractLatestAnswer(documentRef, sourceUrl);
  const last = [...documentRef.querySelectorAll(adapter(provider).messageSelector)].at(-1);
  return extractAnswerFromTarget(last ?? null, sourceUrl);
}
