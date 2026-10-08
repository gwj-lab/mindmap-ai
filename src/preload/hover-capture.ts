import type { CaptureAcknowledgement } from "../shared/types.js";
import { findAssistantMessage, isAssistantMessageStreaming } from "./answer-adapter.js";

const HOVER_CLASS = "mindmap-ai-hover-target";
const BADGE_CLASS = "mindmap-ai-capture-badge";
const STYLE_ID = "mindmap-ai-hover-style";

type CaptureHoveredAnswer = (message: Element) => Promise<CaptureAcknowledgement>;

export function renderCaptureBadge(message: Element, acknowledgement: CaptureAcknowledgement): HTMLElement {
  message.querySelector(`:scope > .${BADGE_CLASS}`)?.remove();
  const badge = message.ownerDocument.createElement("span");
  badge.className = `${BADGE_CLASS} ${BADGE_CLASS}--${acknowledgement.status}`;
  badge.setAttribute("role", "status");
  badge.textContent = acknowledgement.status === "captured"
    ? "Mindmap AI · 已捕获"
    : acknowledgement.status === "duplicate"
      ? "Mindmap AI · 已存在"
      : `Mindmap AI · ${acknowledgement.message}`;
  message.append(badge);
  return badge;
}

export class HoverCaptureController {
  #active: Element | null = null;
  #capturing: Element | null = null;
  #started = false;

  constructor(
    private readonly documentRef: Document,
    private readonly capture: CaptureHoveredAnswer,
    private enabled = true,
    private readonly sourceUrl = "https://chatgpt.com/"
  ) {}

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#installStyle();
    this.documentRef.addEventListener("mouseover", this.#onMouseOver, true);
    this.documentRef.addEventListener("mouseout", this.#onMouseOut, true);
    this.documentRef.addEventListener("dblclick", this.#onDoubleClick, true);
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.#deactivate();
  }

  stop(): void {
    if (!this.#started) return;
    this.#deactivate();
    this.#capturing = null;
    this.documentRef.removeEventListener("mouseover", this.#onMouseOver, true);
    this.documentRef.removeEventListener("mouseout", this.#onMouseOut, true);
    this.documentRef.removeEventListener("dblclick", this.#onDoubleClick, true);
    this.documentRef.querySelectorAll(`.${BADGE_CLASS}`).forEach((badge) => badge.remove());
    this.documentRef.getElementById(STYLE_ID)?.remove();
    this.#started = false;
  }

  readonly #onMouseOver = (event: MouseEvent): void => {
    if (!this.enabled) return;
    const message = findAssistantMessage(event.target, this.sourceUrl);
    if (!message || message === this.#active) return;
    this.#activate(message);
  };

  readonly #onMouseOut = (event: MouseEvent): void => {
    if (!this.#active) return;
    const next = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (next && this.#active.contains(next)) return;
    if (findAssistantMessage(event.target, this.sourceUrl) === this.#active) this.#deactivate();
  };

  readonly #onDoubleClick = (event: MouseEvent): void => {
    const message = findAssistantMessage(event.target, this.sourceUrl);
    if (!this.enabled || !message || message !== this.#active || this.#capturing === message) return;
    event.preventDefault();
    event.stopPropagation();
    if (isAssistantMessageStreaming(message, this.sourceUrl)) {
      renderCaptureBadge(message, { status: "failed", message: "回答仍在生成，请稍后双击" });
      return;
    }
    this.#capturing = message;
    void this.capture(message)
      .then((acknowledgement) => renderCaptureBadge(message, acknowledgement))
      .catch((error: unknown) => renderCaptureBadge(message, {
        status: "failed",
        message: error instanceof Error ? error.message : "捕获失败"
      }))
      .finally(() => {
        if (this.#capturing === message) this.#capturing = null;
      });
  };

  #activate(message: Element): void {
    this.#deactivate();
    this.#active = message;
    message.classList.add(HOVER_CLASS);
  }

  #deactivate(): void {
    this.#active?.classList.remove(HOVER_CLASS);
    this.#active = null;
  }

  #installStyle(): void {
    if (this.documentRef.getElementById(STYLE_ID)) return;
    const style = this.documentRef.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${HOVER_CLASS} { outline: 2px solid #15a995 !important; outline-offset: 4px !important; border-radius: 8px !important; }
      .${BADGE_CLASS} { position: absolute !important; z-index: 2147483646 !important; right: 8px !important; top: 8px !important; padding: 4px 8px !important; border-radius: 12px !important; color: white !important; background: #164c48 !important; font: 11px/1.3 system-ui !important; pointer-events: none !important; }
      .${BADGE_CLASS}--failed { background: #a13d32 !important; }
    `;
    (this.documentRef.head ?? this.documentRef.documentElement).append(style);
  }
}
