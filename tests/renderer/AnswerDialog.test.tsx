// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { webcrypto } from "node:crypto";
import type { AnswerDocument } from "../../src/shared/types.js";
import type { ConceptRecord } from "../../src/shared/concepts.js";
import { AnswerDialog } from "../../src/renderer/src/components/AnswerDialog.js";

vi.mock("@uiw/react-codemirror", () => ({ default: ({ value, onChange }: { value: string; onChange(value: string): void }) => <textarea aria-label="笔记正文" value={value} onChange={(event) => onChange(event.target.value)} /> }));
const selection = { text: "残差", sentence: "残差是差值。", prefix: "", suffix: "是差值。" };
const records = ["残差", "预测值"].map((title, index): ConceptRecord => ({
  id: `concept-${index}`, answerId: `note-${index}`, title, provider: "chatgpt", status: "ready", tabId: `tab-${index}`, prompt: "", createdAt: "2026-10-11T00:00:00.000Z",
  references: [{ sourceAnswerId: "source", sourceTitle: "回归模型", selection, projectId: "p", sourceUrl: "https://chatgpt.com/c/source", sourceMessageId: "source" }]
}));
const documents = Object.fromEntries(["source", "note-0", "note-1"].map((id): [string, AnswerDocument] => [id, {
  metadata: { schemaVersion: 1, id, provider: "chatgpt", title: id === "source" ? "回归模型" : records.find((record) => record.answerId === id)!.title,
    sourceUrl: "https://chatgpt.com/c/source", sourceMessageId: "source", contentHash: "hash", capturedAt: "2026-10-11T00:00:00.000Z", updatedAt: "2026-10-11T00:00:00.000Z" },
  body: id === "source" ? "# 回归模型\n\n残差是差值。" : `# ${records.find((record) => record.answerId === id)!.title}\n\n概念解释。`
}]));
beforeEach(() => {
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: vi.fn(() => [{ left: 20, top: 20, width: 32, height: 20, bottom: 40, right: 52 }]) });
  vi.stubGlobal("crypto", webcrypto);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  const stored = new Map(Object.entries(structuredClone(documents)));
  Object.assign(window, { mindmapAI: { clipboard: { readText: vi.fn(async () => '粘贴的 Markdown 文本'), writeText: vi.fn(async () => undefined) }, project: { readAnswer: vi.fn(async (id: string) => stored.get(id)), writeAnswer: vi.fn(async (answer: AnswerDocument) => { stored.set(answer.metadata.id, answer); }) } } });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function openReader() {
  const onClose = vi.fn();
  const result = render(<AnswerDialog answerId="source" nodeUid="node" records={records} onClose={onClose} onRetitle={vi.fn()} />);
  return { ...result, onClose };
}
test('copies reader text and pastes into an unsaved editing draft through buttons and shortcuts', async () => {
  const { container } = openReader(); await screen.findByText('残差是差值。');
  fireEvent.click(screen.getByRole('button', { name: '复制阅读内容' }));
  await waitFor(() => expect(window.mindmapAI.clipboard.writeText).toHaveBeenCalledWith(documents.source!.body));
  const pane = container.querySelector('.answer-pane')!;
  fireEvent.keyDown(pane, { key: 'v', ctrlKey: true });
  await waitFor(() => expect(screen.getByLabelText('笔记正文')).toHaveValue(documents.source!.body + '\n\n粘贴的 Markdown 文本'));
  expect(window.mindmapAI.project.writeAnswer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '关闭编辑页面' }));
  fireEvent.keyDown(pane, { key: 'c', ctrlKey: true });
  await waitFor(() => expect(window.mindmapAI.clipboard.writeText).toHaveBeenLastCalledWith(documents.source!.body + '\n\n粘贴的 Markdown 文本'));
});
test("resizes editor panes with the keyboard and closes editing without discarding the draft", async () => {
  openReader(); await screen.findByText('残差是差值。');
  fireEvent.click(screen.getByRole('button', { name: '编辑', exact: true }));
  fireEvent.change(screen.getByLabelText('笔记正文'), { target: { value: '尚未保存的修改' } });
  const separator = screen.getByRole('separator', { name: '调整 Markdown 与预览宽度' });
  fireEvent.keyDown(separator, { key: 'ArrowRight' }); expect(separator).toHaveAttribute('aria-valuenow', '55');
  fireEvent.keyDown(separator, { key: 'End' }); expect(separator).toHaveAttribute('aria-valuenow', '80');
  fireEvent.doubleClick(separator); expect(separator).toHaveAttribute('aria-valuenow', '50');
  fireEvent.click(screen.getByRole('button', { name: '关闭编辑页面' }));
  expect(screen.queryByLabelText('笔记正文')).toBeNull();
  expect(screen.getByText('尚未保存的修改')).toBeInTheDocument();
  expect(window.mindmapAI.project.writeAnswer).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '编辑', exact: true }));
  expect(screen.getByLabelText('笔记正文')).toHaveValue('尚未保存的修改');
});

test("shows failed and ready answers as comments, with retry and no concept sidebar entry", async () => {
  const onRetry = vi.fn();
  const annotation: ConceptRecord = { ...records[0]!, id: 'question', answerId: 'qa-note', kind: 'qa', title: '残差', prompt: '为什么是差值？', status: 'failed', error: '请重试' };
  const props = { answerId: 'source', nodeUid: 'node', onClose: vi.fn(), onRetitle: vi.fn(), onRetryQuestion: onRetry };
  const result = render(<AnswerDialog {...props} records={[...records, annotation]} />);
  await screen.findByText('残差是差值。');
  expect(result.container.querySelectorAll('.concept-tab')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: '打开答疑：残差', exact: true }));
  const card = screen.getByLabelText('答疑批注', { exact: true });
  expect(card).toHaveTextContent('为什么是差值？');
  fireEvent.click(within(card).getByRole('button', { name: '重试答疑' }));
  expect(onRetry).toHaveBeenCalledWith('question');
  const original = window.mindmapAI.project.readAnswer;
  window.mindmapAI.project.readAnswer = vi.fn(async (id) => id === 'qa-note' ? { ...documents.source!, metadata: { ...documents.source!.metadata, id: 'qa-note', annotationId: 'question' }, body: '批注回答正文。\n\n## 提问\n\n> 为什么是差值？\n\n## 批注来源\n\n[source](source.md)' } : original(id));
  result.rerender(<AnswerDialog {...props} records={[...records, { ...annotation, status: 'ready' }]} />);
  await waitFor(() => expect(card).toHaveTextContent('批注回答正文。'));
  expect(within(card).queryByRole('heading', { name: '提问' })).toBeNull();
  expect(result.container.querySelectorAll('.concept-tab')).toHaveLength(2);
});

test("previews one concept at a time, opens only on blank double click and returns to the original scroll position", async () => {
  const { container } = openReader();
  await screen.findByText("残差是差值。");
  const source = container.querySelector<HTMLElement>('[data-answer-id="source"] .markdown-preview')!;
  source.scrollTop = 64;
  fireEvent.click(screen.getByRole("button", { name: "残差", exact: true }));
  const preview = container.querySelector(".concept-tab-preview")!;
  await waitFor(() => expect(preview).toHaveTextContent("概念解释。"));
  expect(screen.getByRole("button", { name: "预测值", exact: true })).toHaveAttribute("aria-expanded", "false");
  fireEvent.doubleClick(within(preview as HTMLElement).getByText("概念解释。"));
  expect(screen.queryByRole("button", { name: "回退到节点页面" })).toBeNull();
  fireEvent.doubleClick(preview);
  await screen.findByRole("button", { name: "回退到节点页面" });
  expect(container.querySelector('[data-answer-id="source"]')).toHaveAttribute("hidden");
  fireEvent.click(screen.getByRole("button", { name: "回退到节点页面" }));
  expect(source.closest(".answer-pane")).not.toHaveAttribute("hidden");
  expect(source.scrollTop).toBe(64);
  fireEvent.click(screen.getByRole("button", { name: "预测值", exact: true }));
  expect(container.querySelectorAll(".concept-tab-preview")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "残差", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("maximizes and restores the window without losing its position", async () => {
  const { container } = openReader();
  await screen.findByText("残差是差值。");
  const reader = container.querySelector<HTMLElement>(".answer-dialog")!;
  const position = [reader.style.left, reader.style.top];
  fireEvent.click(screen.getByRole("button", { name: "最大化窗口" }));
  expect(reader).toHaveClass("answer-dialog--maximized");
  fireEvent.click(screen.getByRole("button", { name: "还原窗口" }));
  expect(reader).not.toHaveClass("answer-dialog--maximized");
  expect([reader.style.left, reader.style.top]).toEqual(position);
});

test("keeps unsaved node edits across concept navigation, guards close and saves the current document with Ctrl+S", async () => {
  const { container, onClose } = openReader();
  await screen.findByText("残差是差值。");
  fireEvent.click(screen.getByRole("button", { name: "编辑", exact: true }));
  fireEvent.change(screen.getByLabelText("笔记正文"), { target: { value: "修改后的节点正文" } });
  fireEvent.click(screen.getByRole("button", { name: "残差", exact: true }));
  fireEvent.click(screen.getByRole("button", { name: "完整打开概念：残差" }));
  await screen.findByRole("button", { name: "回退到节点页面" });
  fireEvent.click(screen.getByRole("button", { name: "回退到节点页面" }));
  expect(screen.getByLabelText("笔记正文")).toHaveValue("修改后的节点正文");
  vi.spyOn(window, "confirm").mockReturnValue(false);
  fireEvent.click(screen.getByRole("button", { name: "关闭阅读窗口" }));
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("笔记正文"), { key: "s", ctrlKey: true });
  await waitFor(() => expect(window.mindmapAI.project.writeAnswer).toHaveBeenCalledWith(expect.objectContaining({ body: "修改后的节点正文", metadata: expect.objectContaining({ id: "source" }) })));
  await waitFor(() => expect(container.querySelector('[data-answer-id="source"] footer')).toHaveTextContent("内容已保存"));
  expect(screen.getByLabelText("笔记正文")).toHaveValue("修改后的节点正文");
  fireEvent.click(screen.getByRole("button", { name: "关闭阅读窗口" }));
  expect(onClose).toHaveBeenCalledOnce();
});
