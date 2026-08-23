// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CaptureAcknowledgement } from "../../src/shared/types.js";
import { HoverCaptureController, renderCaptureBadge } from "../../src/preload/hover-capture.js";

function installTurns(streaming = false): { first: Element; second: Element } {
  document.body.innerHTML = `
    <article id="first" data-message-author-role="assistant" data-message-id="one"${streaming ? ' data-is-streaming="true"' : ""}>
      <div class="markdown"><p>First answer</p></div>
    </article>
    <article id="second" data-message-author-role="assistant" data-message-id="two">
      <div class="markdown"><p>Second answer</p></div>
    </article>`;
  return {
    first: document.querySelector("#first p")!,
    second: document.querySelector("#second p")!
  };
}

const captured = (): CaptureAcknowledgement => ({
  status: "captured",
  answer: {
    metadata: {
      id: "answer-id", provider: "chatgpt", title: "First answer",
      sourceUrl: "https://chatgpt.com/c/test", sourceMessageId: "one", contentHash: "hash",
      capturedAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z"
    },
    body: "First answer"
  },
  candidate: { id: "candidate", answerId: "answer-id", title: "First answer", createdAt: "2026-08-18T00:00:00.000Z" }
});

describe("hover capture controller", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test("highlights on hover but captures only on double-click", async () => {
    const { first } = installTurns();
    const capture = vi.fn().mockResolvedValue(captured());
    const controller = new HoverCaptureController(document, capture);
    controller.start();

    first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(document.querySelector("#first")?.classList.contains("mindmap-ai-hover-target")).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(capture).not.toHaveBeenCalled();

    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await Promise.resolve();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(document.querySelector("#first"));
    controller.stop();
  });

  test("captures only the assistant answer under the double-click", async () => {
    const { first, second } = installTurns();
    const capture = vi.fn().mockResolvedValue(captured());
    const controller = new HoverCaptureController(document, capture);
    controller.start();

    first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    second.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    expect(document.querySelectorAll(".mindmap-ai-hover-target")).toHaveLength(1);
    second.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await Promise.resolve();
    expect(capture).toHaveBeenCalledWith(document.querySelector("#second"));
    controller.stop();
  });

  test("refuses a streaming answer without invoking persistence", async () => {
    const { first } = installTurns(true);
    const capture = vi.fn().mockResolvedValue(captured());
    const controller = new HoverCaptureController(document, capture);
    controller.start();
    first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
    expect(document.querySelector(".mindmap-ai-capture-badge")?.textContent).toContain("仍在生成");
    controller.stop();
  });

  test("does not send a second request while the active answer is being captured", async () => {
    const { first } = installTurns();
    let finish: ((value: CaptureAcknowledgement) => void) | undefined;
    const capture = vi.fn(() => new Promise<CaptureAcknowledgement>((resolve) => { finish = resolve; }));
    const controller = new HoverCaptureController(document, capture);
    controller.start();
    first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

    expect(capture).toHaveBeenCalledTimes(1);
    finish?.(captured());
    await Promise.resolve();
    controller.stop();
  });

  test("honors disabled mode and renders removable acknowledgement badges", async () => {
    const { first } = installTurns();
    const capture = vi.fn().mockResolvedValue(captured());
    const controller = new HoverCaptureController(document, capture, false);
    controller.start();
    first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    await Promise.resolve();
    expect(capture).not.toHaveBeenCalled();
    expect(document.querySelector(".mindmap-ai-hover-target")).toBeNull();

    const turn = document.querySelector("#first")!;
    renderCaptureBadge(turn, captured());
    expect(turn.querySelector(".mindmap-ai-capture-badge")?.textContent).toContain("已捕获");
    renderCaptureBadge(turn, { status: "duplicate", answerId: "answer-id" });
    expect(turn.querySelector(".mindmap-ai-capture-badge")?.textContent).toContain("已存在");
    renderCaptureBadge(turn, { status: "failed", message: "保存失败" });
    expect(turn.querySelector(".mindmap-ai-capture-badge")?.textContent).toContain("保存失败");
    controller.stop();
    expect(document.querySelector(".mindmap-ai-capture-badge")).toBeNull();
    expect(turn.textContent).toContain("First answer");
  });
});
