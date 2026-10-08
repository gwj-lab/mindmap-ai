import type { CapturedAnswerPayload, ProviderId } from "../shared/types.js";
import { extractLatestAnswer } from "./answer-adapter.js";

const selectors: Record<ProviderId, { editor: string; send: string }> = {
  chatgpt: { editor: '#prompt-textarea, textarea[name="prompt-textarea"]', send: '[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="发送提示"]' },
  yuanbao: { editor: '.ql-editor[contenteditable="true"], textarea, [contenteditable="true"][role="textbox"]', send: '#yuanbao-send-btn, .agent-chat__input__send, .agent-chat__input-send, .input-send-btn, button[aria-label*="发送"]' },
  doubao: { editor: '.tiptap.ProseMirror[contenteditable="true"], [data-testid="chat_input_input"], textarea, [contenteditable="true"][role="textbox"]', send: '[data-testid="chat_input_send_button"], button[aria-label*="发送"]' }
};
function editorFor(documentRef: Document, provider: ProviderId): HTMLElement | null {
  return [...documentRef.querySelectorAll<HTMLElement>(selectors[provider].editor)].find((element) => !element.closest('[aria-hidden="true"]') && !element.hasAttribute("disabled") && element.getClientRects().length > 0) ?? null;
}
export function sendConceptPrompt(documentRef: Document, provider: ProviderId, prompt: string): boolean {
  const editor = editorFor(documentRef, provider);
  if (!editor) return false;
  editor.focus();
  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    Object.getOwnPropertyDescriptor(editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(editor, prompt);
  } else { editor.replaceChildren(documentRef.createTextNode(prompt)); }
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
  // React input state and submit button update on the next event loop turn.
  documentRef.defaultView?.setTimeout(() => {
    const button = documentRef.querySelector<HTMLElement>(selectors[provider].send);
    if (button && !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true" && button.getAttribute("data-disabled") !== "true") button.click();
    else {
      editor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      editor.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
    }
  }, 100);
  return true;
}
export async function generateConcept(documentRef: Document, provider: ProviderId, prompt: string, signal: AbortSignal): Promise<CapturedAnswerPayload> {
  const initial = await extractLatestAnswer(documentRef, documentRef.location.href);
  const started = Date.now();
  let sent = false, stableSince = 0, previous = "";
  while (!signal.aborted && Date.now() - started < 180000) {
    if (!sent) sent = sendConceptPrompt(documentRef, provider, prompt);
    if (!sent && Date.now() - started > 30000) throw new Error("未找到可用输入框，请登录或完成验证后重试");
    if (sent) {
      const answer = await extractLatestAnswer(documentRef, documentRef.location.href);
      if (answer && answer.sourceMessageId !== initial?.sourceMessageId) {
        const fingerprint = answer.sourceMessageId + answer.markdown;
        if (fingerprint !== previous) { previous = fingerprint; stableSince = Date.now(); }
        else if (Date.now() - stableSince >= 3000) return answer;
      } else { previous = ""; stableSince = 0; }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(signal.aborted ? "生成页面已关闭" : "生成超时，请查看生成页面后重试");
}
