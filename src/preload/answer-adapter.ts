import { contentHash } from "../shared/content.js";
import type { CapturedAnswerPayload } from "../shared/types.js";
import * as chatgpt from "./chatgpt-adapter.js";
import { doubaoAdapter } from "./doubao-adapter.js";
import { yuanbaoAdapter } from "./yuanbao-adapter.js";
import { deepseekAdapter } from './deepseek-adapter.js';
import { kimiAdapter } from './kimi-adapter.js';
import { providerForUrl } from '../shared/ai-providers.js';

const platform = providerForUrl;
const adapters = { doubao: doubaoAdapter, yuanbao: yuanbaoAdapter, deepseek: deepseekAdapter, kimi: kimiAdapter };
function adapter(provider: keyof typeof adapters): { messageSelector: string; content(message: Element): Element; toMarkdown(content: Element, sourceUrl: string, nativeMarkdown?: string): string } { return adapters[provider]; }
let nativeReader: ((message: Element) => Promise<string | null>) | undefined;
const nativeCache = new WeakMap<Element, { text: string; markdown: string }>();
export function setNativeMarkdownReader(reader: (message: Element) => Promise<string | null>): void { nativeReader = reader; }

export function findAssistantMessage(target: EventTarget | null, sourceUrl = "https://chatgpt.com/"): Element | null {
  let provider: ReturnType<typeof platform>;
  try { provider = platform(sourceUrl); } catch { return null; }
  if (provider === "chatgpt") return chatgpt.findAssistantMessage(target, sourceUrl);
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const message = element?.closest(adapter(provider).messageSelector) ?? null;
  if (provider === 'kimi') return message?.closest('.chat-content-item-assistant') ?? message;
  return provider === "doubao" ? message?.closest('[data-testid="receive_message"]') ?? message : message;
}

export function isAssistantMessageStreaming(message: Element, sourceUrl = "https://chatgpt.com/"): boolean {
  const provider = platform(sourceUrl);
  if (provider === "chatgpt") return chatgpt.isAssistantMessageStreaming(message);
  if (message.matches('[data-is-streaming="true"], [data-streaming="true"], [aria-busy="true"]') || message.querySelector('[data-is-streaming="true"], [data-streaming="true"], [aria-busy="true"]')) return true;
  const last = [...message.ownerDocument.querySelectorAll(adapter(provider).messageSelector)].at(-1);
  return Boolean(last && message.contains(last) && message.ownerDocument.querySelector(
    '[data-testid="stop-button"], [data-testid="stop_generate"], [aria-label*="停止回答"], [aria-label*="停止生成"], .send-button-container.stop, .send-button-container.loading, .ds-button--primary.ds-button--circle .ds-loading, .ds-button--primary.ds-button--circle path[d^="M2 4.88C2"]'
  ));
}

export async function extractSelectedAnswer(content: Element, sourceUrl: string, message: Element = content): Promise<CapturedAnswerPayload> {
  const provider = platform(sourceUrl);
  if (provider === "chatgpt") return chatgpt.extractSelectedAnswer(content, sourceUrl, message);
  let nativeMarkdown: string | undefined;
  if (provider === 'kimi' && nativeReader && content.querySelector('.katex-wrapper:not(:has(annotation))')) {
    const text = content.textContent ?? '';
    const cached = nativeCache.get(message);
    nativeMarkdown = cached?.text === text ? cached.markdown : (await nativeReader(message)) ?? undefined;
    if (nativeMarkdown) nativeCache.set(message, { text, markdown: nativeMarkdown });
  }
  const markdown = adapter(provider).toMarkdown(content, sourceUrl, nativeMarkdown);
  if (!markdown.trim()) throw new Error("Selected answer is empty");
  const sourceMessageId = message.getAttribute("data-message-id") || message.getAttribute('data-archer-id') || message.closest('[data-virtual-list-item-key]')?.getAttribute('data-virtual-list-item-key') || message.querySelector("[data-message-id]")?.getAttribute("data-message-id") || message.querySelector("[data-trace-id]")?.getAttribute("data-trace-id") || message.id || `assistant-${(await contentHash(markdown)).slice(0, 16)}`;
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
