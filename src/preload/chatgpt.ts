import { ipcRenderer } from "electron";
import type { CapturedAnswerPayload, CaptureAcknowledgement } from "../shared/types.js";
import { CaptureDelivery } from "./chatgpt-adapter.js";
import { extractAnswerFromTarget, extractLatestAnswer, findAssistantMessage } from "./answer-adapter.js";
import { HoverCaptureController } from "./hover-capture.js";
import { ConceptSelectionController } from "../shared/concept-selection.js";
import { generateConcept } from "./concept-generation.js";
import type { ConceptRecord } from "../shared/concepts.js";

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
let conceptController: ConceptSelectionController | undefined;
let conceptRecords: ConceptRecord[] = [];
let generation: AbortController | null = null;
function paintConcepts(): void {
  const marks = conceptRecords.flatMap((record) => record.status === "ready" || record.status === "generating" ? record.references.filter((ref) => ref.sourceUrl === location.href).flatMap((ref) => {
    const messages = document.querySelectorAll('[data-message-author-role="assistant"],.agent-chat__bubble--ai,[data-testid="receive_message"]');
    const root = [...messages].find((message) => message.getAttribute("data-message-id") === ref.sourceMessageId || message.querySelector("[data-message-id]")?.getAttribute("data-message-id") === ref.sourceMessageId || message.querySelector("[data-trace-id]")?.getAttribute("data-trace-id") === ref.sourceMessageId);
    return root ? [{ root, mark: { id: record.answerId, selection: ref.selection, pending: record.status === "generating" } }] : [];
  }) : []);
  conceptController?.setMarks(marks);
}

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
  const findTarget = (eventTarget: EventTarget | null): Element | null => findAssistantMessage(eventTarget, location.href);
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
    void extractAnswerFromTarget(selected, location.href)
      .then((payload) => { if (payload) return emitCapture(payload); })
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
  conceptController = new ConceptSelectionController(document, (node) => findAssistantMessage(node, location.href), (root, selection) => {
    void extractAnswerFromTarget(root, location.href).then((payload) => {
      if (!payload) throw new Error("回答仍在生成，请稍候");
      return ipcRenderer.invoke("concepts:select-page", { payload, selection });
    }).catch((error: unknown) => ipcRenderer.send(IPC.aiAdapterErrorFromPage, error instanceof Error ? error.message : "概念选取失败"));
  }, (id) => ipcRenderer.send("concepts:open-page", id));
  paintConcepts();
  void ipcRenderer.invoke("concepts:page-marks").then((records: ConceptRecord[]) => { conceptRecords = records; paintConcepts(); }).catch(() => undefined);
  const refresh = setInterval(paintConcepts, 1500);
  window.addEventListener("pagehide", () => { clearInterval(refresh); conceptController?.destroy(); generation?.abort(); }, { once: true });
  hoverController = new HoverCaptureController(document, async (message) => {
    const payload = await extractAnswerFromTarget(message, location.href);
    if (!payload) return { status: "failed", message: "回答仍在生成，请稍候" };
    return emitCapture(payload);
  }, true, location.href);
  hoverController.start();
});

ipcRenderer.on("concepts:marks", (_event, records: ConceptRecord[]) => { conceptRecords = records; paintConcepts(); });
ipcRenderer.on("concepts:generate", (_event, job: { id: string; provider: "chatgpt" | "yuanbao" | "doubao"; prompt: string }) => {
  generation?.abort(); generation = new AbortController();
  void generateConcept(document, job.provider, job.prompt, generation.signal).then((payload) => ipcRenderer.invoke("concepts:generated-page", { id: job.id, payload }))
    .catch((error: unknown) => ipcRenderer.invoke("concepts:failed-page", { id: job.id, error: error instanceof Error ? error.message : "概念生成失败" })).catch(() => undefined);
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
