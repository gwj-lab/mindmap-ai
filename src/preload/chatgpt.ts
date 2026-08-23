import { ipcRenderer } from "electron";
import type { CapturedAnswerPayload, CaptureAcknowledgement } from "../shared/types.js";
import { CaptureDelivery, extractAnswerFromTarget, extractLatestAnswer, extractSelectedAnswer } from "./chatgpt-adapter.js";
import { HoverCaptureController } from "./hover-capture.js";

const IPC = {
  aiCaptureLatest: "ai:capture-latest",
  aiPickAnswer: "ai:pick-answer",
  aiSetHoverCapture: "ai:set-hover-capture",
  aiCapturedFromPage: "ai:captured-from-page",
  aiAdapterErrorFromPage: "ai:adapter-error-from-page"
} as const;

const delivery = new CaptureDelivery();
let pickerCleanup: (() => void) | undefined;
let hoverController: HoverCaptureController | undefined;

async function emitCapture(payload: CapturedAnswerPayload): Promise<CaptureAcknowledgement> {
  return delivery.deliver(
    payload,
    (answer) => ipcRenderer.invoke(IPC.aiCapturedFromPage, answer) as Promise<CaptureAcknowledgement>
  );
}

async function captureLatest(): Promise<boolean> {
  try {
    const payload = await extractLatestAnswer(document, location.href);
    if (!payload) return false;
    return (await emitCapture(payload)).status !== "failed";
  } catch (error) {
    ipcRenderer.send(IPC.aiAdapterErrorFromPage, error instanceof Error ? error.message : "回答提取失败");
    return false;
  }
}

function activatePicker(): void {
  pickerCleanup?.();
  const style = document.createElement("style");
  style.textContent = `
    .mindmap-ai-pick-target { outline: 3px solid #15b8a6 !important; outline-offset: 3px !important; cursor: crosshair !important; }
    body::before { content: "点击要保存的回答 · Esc 取消"; position: fixed; z-index: 2147483647; top: 12px; left: 50%; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px; background: #10252b; color: white; font: 13px system-ui; box-shadow: 0 8px 24px #0005; }
  `;
  document.head.append(style);
  let target: Element | null = null;
  const findTarget = (eventTarget: EventTarget | null): Element | null =>
    eventTarget instanceof Element
      ? eventTarget.closest('[data-message-author-role="assistant"], article, main section')
      : null;
  const onMove = (event: MouseEvent): void => {
    target?.classList.remove("mindmap-ai-pick-target");
    target = findTarget(event.target);
    target?.classList.add("mindmap-ai-pick-target");
  };
  const cleanup = (): void => {
    target?.classList.remove("mindmap-ai-pick-target");
    style.remove();
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    pickerCleanup = undefined;
  };
  const onClick = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    const selected = findTarget(event.target);
    cleanup();
    if (!selected) return;
    void extractSelectedAnswer(selected.querySelector(".markdown, [data-message-content]") ?? selected, location.href, selected)
      .then(emitCapture)
      .catch((error: unknown) => ipcRenderer.send(
        IPC.aiAdapterErrorFromPage,
        error instanceof Error ? error.message : "点选回答失败"
      ));
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") cleanup();
  };
  pickerCleanup = cleanup;
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
}

window.addEventListener("DOMContentLoaded", () => {
  hoverController = new HoverCaptureController(document, async (message) => {
    const payload = await extractAnswerFromTarget(message, location.href);
    if (!payload) return { status: "failed", message: "回答仍在生成，请稍候" };
    return emitCapture(payload);
  });
  hoverController.start();
});

ipcRenderer.on(IPC.aiSetHoverCapture, (_event, enabled: unknown) => {
  if (typeof enabled === "boolean") hoverController?.setEnabled(enabled);
});

ipcRenderer.on(IPC.aiCaptureLatest, () => {
  void captureLatest().then((captured) => {
    if (!captured) activatePicker();
  });
});

ipcRenderer.on(IPC.aiPickAnswer, activatePicker);
