import { contentHash, htmlToMarkdown } from "../shared/content.js";
import { chatgptRichToMarkdown, isRichChatgpt } from './chatgpt-rich.js';
import type { CapturedAnswerPayload, CaptureAcknowledgement } from "../shared/types.js";

function providerForUrl(sourceUrl: string): CapturedAnswerPayload["provider"] {
  const host = new URL(sourceUrl).hostname;
  if (host === "yuanbao.tencent.com") return "yuanbao";
  if (host === "www.doubao.com") return "doubao";
  if (host === "chatgpt.com") return "chatgpt";
  throw new Error("不支持的问答网站");
}

function messageSelector(sourceUrl: string): string {
  switch (providerForUrl(sourceUrl)) {
    case "yuanbao": return ".agent-chat__bubble--ai";
    case "doubao": return '[data-testid="receive_message"], [class*="bg-g-receive-msg-bubble"]';
    default: return MESSAGE_SELECTOR;
  }
}

const MESSAGE_SELECTOR = [
  "[data-content-search-unit-key]",
  '[data-message-author-role="assistant"]',
  '[data-author="assistant"]',
  "article[data-testid^='conversation-turn-']"
].join(",");

function isAssistant(element: Element): boolean {
  const role = element.getAttribute("data-message-author-role")
    ?? element.getAttribute("data-author")
    ?? element.getAttribute("data-conversation-role");
  if (role) return role === "assistant";
  return Boolean(element.querySelector(
    '[data-conversation-role="assistant"], [data-message-author-role="assistant"], [data-author="assistant"]'
  ));
}

export function isAssistantMessageStreaming(element: Element): boolean {
  return element.getAttribute("data-is-streaming") === "true"
    || Boolean(element.querySelector('[data-is-streaming="true"]'))
    || Boolean(element.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]'))
    || (element === [...element.ownerDocument.querySelectorAll('[data-content-search-unit-key], [data-message-author-role="assistant"]')].filter(isAssistant).at(-1)
      && Boolean(element.ownerDocument.querySelector('[data-testid="stop-button"], button[aria-label="停止流式传输"], button[aria-label="Stop streaming"]')));
}

export function findAssistantMessage(target: EventTarget | null, sourceUrl = "https://chatgpt.com/"): Element | null {
  let provider: CapturedAnswerPayload["provider"];
  try {
    provider = providerForUrl(sourceUrl);
  } catch {
    return null;
  }
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  const message = element?.closest(messageSelector(sourceUrl)) ?? null;
  if (!message) return null;
  return provider !== "chatgpt" || isAssistant(message) ? message : null;
}

function messageContent(message: Element, sourceUrl: string): Element {
  const provider = providerForUrl(sourceUrl);
  if (provider === "yuanbao") return message.querySelector(".agent-chat__bubble__content, .hyc-common-markdown, .markdown") ?? message;
  if (provider === "doubao") return message.querySelector(".markdown, [class*='markdown'], [data-testid='message_text_content'], [data-testid='message_content']") ?? message;
  const parts = [...message.querySelectorAll('[data-markdown-text-style="assistant-message"]')];
  if (parts.length > 1) {
    if (parts.some(isRichChatgpt)) return message;
    const body = message.ownerDocument.createElement('div');
    parts.forEach((part) => body.append(part.cloneNode(true)));
    return body;
  }
  return message.querySelector(
    "[data-selected-text-overlay-target][data-markdown-text-style], [data-markdown-text-style], .markdown, [data-message-content], [class*='markdown']"
  ) ?? message;
}

export async function extractAnswerFromTarget(
  target: EventTarget | null,
  sourceUrl: string
): Promise<CapturedAnswerPayload | null> {
  const message = findAssistantMessage(target, sourceUrl);
  if (!message || isAssistantMessageStreaming(message)) return null;
  return extractSelectedAnswer(messageContent(message, sourceUrl), sourceUrl, message);
}

export async function extractLatestAnswer(
  documentRef: Document,
  sourceUrl: string
): Promise<CapturedAnswerPayload | null> {
  const provider = providerForUrl(sourceUrl);
  const candidates = [...documentRef.querySelectorAll(messageSelector(sourceUrl))]
    .filter((message) => provider !== "chatgpt" || isAssistant(message));
  const latest = candidates.at(-1);
  if (!latest || isAssistantMessageStreaming(latest)) return null;
  const content = messageContent(latest, sourceUrl);
  return extractSelectedAnswer(content, sourceUrl, latest);
}

export async function extractSelectedAnswer(
  content: Element,
  sourceUrl: string,
  messageContainer: Element = content
): Promise<CapturedAnswerPayload> {
  const markdown = isRichChatgpt(content) ? chatgptRichToMarkdown(content, sourceUrl) : htmlToMarkdown(content);
  if (!markdown.trim()) throw new Error("Selected answer is empty");
  const fallbackId = `assistant-${(await contentHash(markdown)).slice(0, 16)}`;
  const selectionMessageId = messageContainer.matches("[data-chatgpt-selection-message-id]")
    ? messageContainer.getAttribute("data-chatgpt-selection-message-id")
    : messageContainer.querySelector("[data-chatgpt-selection-message-id]")?.getAttribute("data-chatgpt-selection-message-id");
  const provider = providerForUrl(sourceUrl);
  const sourceMessageId = messageContainer.getAttribute("data-message-id")
    || selectionMessageId
    || (provider === "chatgpt" ? messageContainer.getAttribute("data-testid") : null)
    || messageContainer.id
    || fallbackId;
  return { provider, sourceUrl, sourceMessageId, markdown };
}

export class CaptureDeduper {
  readonly #seen = new Set<string>();

  async accept(sourceUrl: string, sourceMessageId: string, markdown: string): Promise<boolean> {
    const key = `${sourceUrl}\u0000${sourceMessageId}\u0000${await contentHash(markdown)}`;
    if (this.#seen.has(key)) return false;
    this.#seen.add(key);
    return true;
  }
}

export class CaptureDelivery {
  readonly #confirmed = new Map<string, string>();
  readonly #pending = new Map<string, Promise<CaptureAcknowledgement>>();

  async deliver(
    payload: CapturedAnswerPayload,
    send: (payload: CapturedAnswerPayload) => Promise<CaptureAcknowledgement>
  ): Promise<CaptureAcknowledgement> {
    const key = `${payload.sourceUrl}\u0000${payload.sourceMessageId}\u0000${await contentHash(payload.markdown)}`;
    const confirmedAnswerId = this.#confirmed.get(key);
    if (confirmedAnswerId) return { status: "duplicate", answerId: confirmedAnswerId };
    const pending = this.#pending.get(key);
    if (pending) {
      const acknowledgement = await pending;
      if (acknowledgement.status === "captured") {
        return { status: "duplicate", answerId: acknowledgement.answer.metadata.id };
      }
      return acknowledgement;
    }
    const request = send(payload);
    this.#pending.set(key, request);
    try {
      const acknowledgement = await request;
      if (acknowledgement.status === "captured") {
        this.#confirmed.set(key, acknowledgement.answer.metadata.id);
      } else if (acknowledgement.status === "duplicate") {
        this.#confirmed.set(key, acknowledgement.answerId);
      }
      return acknowledgement;
    } finally {
      this.#pending.delete(key);
    }
  }
}
