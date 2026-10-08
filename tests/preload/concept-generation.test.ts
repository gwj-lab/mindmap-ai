// @vitest-environment jsdom
// @vitest-environment-options {"url":"https://chatgpt.com/c/concept-test"}
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { generateConcept, sendConceptPrompt } from "../../src/preload/concept-generation.js";
import * as content from "../../src/shared/content.js";
beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(HTMLElement.prototype, "getClientRects", { configurable: true, value: () => [{ width: 100, height: 20 }] }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); });
test.each([
  ["chatgpt", '<textarea id="prompt-textarea"></textarea><button data-testid="send-button">发送</button>'],
  ["yuanbao", '<div class="ql-editor" contenteditable="true"></div><div id="yuanbao-send-btn" role="button">发送</div>'],
  ["doubao", '<div class="tiptap ProseMirror" contenteditable="true"></div><button data-testid="chat_input_send_button">发送</button>']
] as const)("%s sends literal context through its own editor and button", async (provider, html) => {
  document.body.innerHTML = html;
  const editor = document.querySelector("textarea, [contenteditable]")!;
  const submit = vi.fn(); document.querySelector("button,[role=button]")!.addEventListener("click", submit);
  const prompt = '当前主题是“模型”。原句：“残差是误差。”请解释“残差”。<img src=x onerror=alert(1)>';
  expect(sendConceptPrompt(document, provider, prompt)).toBe(true);
  expect(editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent).toBe(prompt);
  expect(document.querySelector("img")).toBeNull();
  await vi.advanceTimersByTimeAsync(101);
  expect(submit).toHaveBeenCalledOnce();
});
test("does not capture the old answer or a new answer still streaming", async () => {
  vi.spyOn(content, "contentHash").mockResolvedValue("b".repeat(64));
  document.body.innerHTML = '<textarea id="prompt-textarea"></textarea><button data-testid="send-button">发送</button><article data-message-author-role="assistant" data-message-id="old"><div class="markdown"><p>旧回答</p></div></article>';
  document.querySelector("button")!.addEventListener("click", () => {
    const article = document.createElement("article"); article.dataset.messageAuthorRole = "assistant"; article.dataset.messageId = "new"; article.dataset.isStreaming = "true"; article.innerHTML = '<div class="markdown"><p>概念解释</p></div>'; document.body.append(article);
    setTimeout(() => article.removeAttribute("data-is-streaming"), 5000);
  });
  let result: unknown;
  const generated = generateConcept(document, "chatgpt", "完整提示词", new AbortController().signal).then((answer) => { result = answer; return answer; });
  await vi.advanceTimersByTimeAsync(4800);
  expect(result).toBeUndefined();
  await vi.advanceTimersByTimeAsync(5000);
  expect(await generated).toMatchObject({ sourceMessageId: "new", markdown: "概念解释" });
});
