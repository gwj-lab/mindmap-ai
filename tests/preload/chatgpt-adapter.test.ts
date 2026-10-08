// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  CaptureDeduper,
  CaptureDelivery
} from "../../src/preload/chatgpt-adapter.js";
import {
  extractAnswerFromTarget,
  extractLatestAnswer,
  extractSelectedAnswer,
  findAssistantMessage
} from "../../src/preload/answer-adapter.js";
import type { AnswerDocument, CapturedAnswerPayload, CaptureAcknowledgement } from "../../src/shared/types.js";

const fixture = (name: string): string => readFileSync(
  resolve(process.cwd(), "tests", "fixtures", "chatgpt", name),
  "utf8"
);

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("ChatGPT adapter contract", () => {
  test("finds only the assistant turn containing the pointer target", () => {
    document.body.innerHTML = fixture("multi-turn.html");
    const answerBody = document.querySelector("#answer-two .answer-body");
    const userBody = document.querySelector("#question-two p");

    expect(findAssistantMessage(answerBody)?.id).toBe("answer-two");
    expect(findAssistantMessage(userBody)).toBeNull();
    expect(findAssistantMessage(document.querySelector("main"))).toBeNull();
  });

  test("extracts the hovered answer without adjacent turns or controls", async () => {
    document.body.innerHTML = fixture("multi-turn.html");
    const target = document.querySelector("#answer-one strong");
    const answer = await extractAnswerFromTarget(target, "https://chatgpt.com/c/multi");

    expect(answer?.sourceMessageId).toBe("answer-1");
    expect(answer?.markdown).toContain("First answer");
    expect(answer?.markdown).not.toContain("Second answer");
    expect(answer?.markdown).not.toContain("Copy");
  });

  test("extracts only the latest completed assistant message", async () => {
    document.body.innerHTML = `
      <article data-message-author-role="assistant" data-message-id="old"><div class="markdown"><p>Old answer</p></div></article>
      <article data-message-author-role="user" data-message-id="user"><p>Question</p></article>
      <article data-message-author-role="assistant" data-message-id="new">
        <div class="markdown"><h2>Final result</h2><p>Use <span class="katex" data-tex="x^2">math</span>.</p></div>
        <button aria-label="Copy">Copy</button>
      </article>
    `;

    const answer = await extractLatestAnswer(document, "https://chatgpt.com/c/abc");
    expect(answer).toMatchObject({
      provider: "chatgpt",
      sourceUrl: "https://chatgpt.com/c/abc",
      sourceMessageId: "new"
    });
    expect(answer?.markdown).toContain("## Final result");
    expect(answer?.markdown).toContain("$x^2$");
    expect(answer?.markdown).not.toContain("Copy");
  });

  test("does not capture while ChatGPT is streaming", async () => {
    document.body.innerHTML = fixture("streaming-turn.html");
    await expect(extractLatestAnswer(document, "https://chatgpt.com/c/abc")).resolves.toBeNull();
    await expect(extractAnswerFromTarget(
      document.querySelector(".markdown p"),
      "https://chatgpt.com/c/abc"
    )).resolves.toBeNull();
  });

  test("deduplicates the same message content but accepts a regeneration", async () => {
    const deduper = new CaptureDeduper();
    expect(await deduper.accept("https://chatgpt.com/c/abc", "message", "First")).toBe(true);
    expect(await deduper.accept("https://chatgpt.com/c/abc", "message", "First")).toBe(false);
    expect(await deduper.accept("https://chatgpt.com/c/abc", "message", "Regenerated")).toBe(true);
  });

  test("retains only confirmed delivery and returns duplicate without sending twice", async () => {
    const delivery = new CaptureDelivery();
    const payload: CapturedAnswerPayload = {
      provider: "chatgpt",
      sourceUrl: "https://chatgpt.com/c/retry",
      sourceMessageId: "answer-1",
      markdown: "Retryable answer"
    };
    const failed: CaptureAcknowledgement = { status: "failed", message: "project is not open" };
    const answer = {
      metadata: { id: "answer-id", provider: "chatgpt", title: "Retryable", sourceUrl: payload.sourceUrl, sourceMessageId: payload.sourceMessageId, contentHash: "hash", capturedAt: "2026-08-18T00:00:00.000Z", updatedAt: "2026-08-18T00:00:00.000Z" },
      body: payload.markdown
    } satisfies AnswerDocument;
    const send = vi.fn<(_payload: CapturedAnswerPayload) => Promise<CaptureAcknowledgement>>()
      .mockResolvedValueOnce(failed)
      .mockResolvedValueOnce({ status: "captured", answer, candidate: { id: "candidate", answerId: "answer-id", title: "Retryable", createdAt: "2026-08-18T00:00:00.000Z" } });

    await expect(delivery.deliver(payload, send)).resolves.toEqual(failed);
    await expect(delivery.deliver(payload, send)).resolves.toMatchObject({ status: "captured" });
    await expect(delivery.deliver(payload, send)).resolves.toEqual({ status: "duplicate", answerId: "answer-id" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("allows retry after transport rejection", async () => {
    const delivery = new CaptureDelivery();
    const payload: CapturedAnswerPayload = { provider: "chatgpt", sourceUrl: "https://chatgpt.com/c/retry", sourceMessageId: "answer-2", markdown: "Retry" };
    await expect(delivery.deliver(payload, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(delivery.deliver(payload, async () => ({ status: "duplicate", answerId: "existing" }))).resolves.toEqual({ status: "duplicate", answerId: "existing" });
  });

  test("manual selection captures a user-picked answer after selectors change", async () => {
    const changedMarkup = document.createElement("section");
    changedMarkup.innerHTML = "<h3>Picked answer</h3><p>Fallback body</p>";
    const answer = await extractSelectedAnswer(changedMarkup, "https://chatgpt.com/c/abc");
    expect(answer.sourceMessageId).toMatch(/^assistant-/);
    expect(answer.markdown).toContain("### Picked answer");
  });

  test("captures Tencent Yuanbao answer bubbles without the prompt or toolbar", async () => {
    document.body.innerHTML = `
      <div class="agent-chat__bubble agent-chat__bubble--human"><div class="agent-chat__bubble__content">User prompt</div></div>
      <div class="agent-chat__bubble agent-chat__bubble--ai" id="yuanbao-answer"><div class="agent-chat__bubble__content"><h2>元宝回答</h2><p>详细内容</p></div><div class="agent-chat__toolbar"><button class="agent-chat__toolbar__copy">复制</button></div></div>`;
    const url = "https://yuanbao.tencent.com/chat/123";
    const answer = await extractLatestAnswer(document, url);
    expect(answer).toMatchObject({ provider: "yuanbao", sourceUrl: url, sourceMessageId: "yuanbao-answer" });
    expect(answer?.markdown).toContain("## 元宝回答");
    expect(answer?.markdown).not.toContain("User prompt");
    expect(answer?.markdown).not.toContain("复制");
    expect(findAssistantMessage(document.querySelector(".agent-chat__bubble--human"), url)).toBeNull();
  });

  test("captures only Doubao receive messages", async () => {
    document.body.innerHTML = `
      <div data-testid="send_message">User prompt</div>
      <div data-testid="receive_message" id="doubao-answer"><div class="markdown"><p>豆包回答</p></div><button>复制</button></div>`;
    const url = "https://www.doubao.com/chat/123";
    const answer = await extractAnswerFromTarget(document.querySelector("#doubao-answer p"), url);
    expect(answer).toMatchObject({ provider: "doubao", sourceUrl: url, sourceMessageId: "doubao-answer" });
    expect(answer?.markdown).toBe("豆包回答");
    expect(await extractLatestAnswer(document, url)).toMatchObject({ provider: "doubao" });
    expect(findAssistantMessage(document.querySelector('[data-testid="send_message"]'), url)).toBeNull();
  });

  test("captures Doubao's newer receive bubble markup", async () => {
    document.body.innerHTML = `
      <div class="bg-g-send-msg-bubble">User prompt</div>
      <div class="bg-g-receive-msg-bubble" id="current-reply"><div class="markdown"><p>New Doubao answer</p></div></div>`;
    const url = "https://www.doubao.com/chat/123";
    expect(await extractLatestAnswer(document, url)).toMatchObject({
      provider: "doubao", sourceMessageId: "current-reply", markdown: "New Doubao answer"
    });
    expect(findAssistantMessage(document.querySelector(".bg-g-send-msg-bubble"), url)).toBeNull();
  });
});
