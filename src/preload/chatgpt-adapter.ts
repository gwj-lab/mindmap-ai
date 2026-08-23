import { contentHash, htmlToMarkdown } from "../shared/content.js";
import type { CapturedAnswerPayload, CaptureAcknowledgement } from "../shared/types.js";

const MESSAGE_SELECTOR = [
  '[data-message-author-role="assistant"]',
  '[data-author="assistant"]',
  "article[data-testid^='conversation-turn-']"
].join(",");

function isAssistant(element: Element): boolean {
  const role = element.getAttribute("data-message-author-role") ?? element.getAttribute("data-author");
  if (role) return role === "assistant";
  return Boolean(element.querySelector('[data-message-author-role="assistant"]'));
}

export function isAssistantMessageStreaming(element: Element): boolean {
  return element.getAttribute("data-is-streaming") === "true"
    || Boolean(element.querySelector('[data-is-streaming="true"]'))
    || Boolean(element.querySelector('[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label*="停止"]'));
}

export function findAssistantMessage(target: EventTarget | null): Element | null {
  const element = target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
  const message = element?.closest(MESSAGE_SELECTOR) ?? null;
  return message && isAssistant(message) ? message : null;
}

function messageContent(message: Element): Element {
  return message.querySelector(".markdown, [data-message-content], [class*='markdown']") ?? message;
}

export async function extractAnswerFromTarget(
  target: EventTarget | null,
  sourceUrl: string
): Promise<CapturedAnswerPayload | null> {
  const message = findAssistantMessage(target);
  if (!message || isAssistantMessageStreaming(message)) return null;
  return extractSelectedAnswer(messageContent(message), sourceUrl, message);
}

export async function extractLatestAnswer(
  documentRef: Document,
  sourceUrl: string
): Promise<CapturedAnswerPayload | null> {
  const candidates = [...documentRef.querySelectorAll(MESSAGE_SELECTOR)].filter(isAssistant);
  const latest = candidates.at(-1);
  if (!latest || isAssistantMessageStreaming(latest)) return null;
  const content = messageContent(latest);
  return extractSelectedAnswer(content, sourceUrl, latest);
}

export async function extractSelectedAnswer(
  content: Element,
  sourceUrl: string,
  messageContainer: Element = content
): Promise<CapturedAnswerPayload> {
  const markdown = htmlToMarkdown(content);
  if (!markdown.trim()) throw new Error("Selected answer is empty");
  const fallbackId = `assistant-${(await contentHash(markdown)).slice(0, 16)}`;
  const sourceMessageId = messageContainer.getAttribute("data-message-id")
    || messageContainer.getAttribute("data-testid")
    || messageContainer.id
    || fallbackId;
  return { provider: "chatgpt", sourceUrl, sourceMessageId, markdown };
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
