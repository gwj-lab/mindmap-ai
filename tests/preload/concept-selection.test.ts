// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConceptSelectionController, findConceptRange, readConceptSelection } from "../../src/shared/concept-selection.js";
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  Object.defineProperty(Range.prototype, "getClientRects", { configurable: true, value: vi.fn(() => [{ left: 20, top: 20, width: 32, height: 20, bottom: 40, right: 52 }]) });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.replaceChildren(); });
function select() {
  const root = document.querySelector("article")!;
  const text = root.querySelector("p")!.firstChild!;
  const range = document.createRange(); range.setStart(text, 5); range.setEnd(text, 7);
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range);
  return { root, range };
}
test('reader selections stay native for copying while concept and question actions remain available', () => {
  document.body.innerHTML = '<article><p>第一句话。残差是观测值与预测值之差。</p></article>';
  const { root } = select();
  const controller = new ConceptSelectionController(document, () => root, vi.fn(), vi.fn(), { onAsk: vi.fn(), preserveSelection: true });
  root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  expect(document.getSelection()!.toString()).toBe('残差');
  expect(root.querySelector('.selection-ask-button')).not.toBeNull();
  controller.destroy();
});
test("long multi-paragraph quotes offer questions, keep their anchor and never generate concepts", () => {
  const first = '第一段解释。'.repeat(30);
  const second = '第二段补充。'.repeat(30);
  document.body.innerHTML = `<article><p>${first}</p><pre><code>const x = 1;</code></pre><p>${second}</p></article>`;
  const root = document.querySelector('article')!;
  const range = document.createRange();
  range.setStart(root.querySelector('p')!.firstChild!, 4);
  range.setEnd(root.querySelectorAll('p')[1]!.firstChild!, second.length - 4);
  const native = document.getSelection()!; native.removeAllRanges(); native.addRange(range);
  const ask = vi.fn(); const generate = vi.fn();
  const controller = new ConceptSelectionController(document, () => root, generate, vi.fn(), { onAsk: ask });
  root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  const button = root.querySelector<HTMLButtonElement>('.selection-ask-button');
  expect(button).not.toBeNull();
  expect(root.querySelector('[aria-label^="生成概念"]')).toBeNull();
  button!.click();
  const selected = ask.mock.calls[0]![1];
  expect(selected.text.length).toBeGreaterThan(160);
  expect(findConceptRange(root, selected)?.toString()).toBe(range.toString());
  expect(generate).not.toHaveBeenCalled();
  controller.destroy();
});
test("restores selections after inline code and formulas using the same visible text context", () => {
  document.body.innerHTML = '<article><p>模型 <code>y=x</code><span class="katex">formula</span> 中残差是差值。</p></article>';
  const root = document.querySelector('article')!;
  const node = root.querySelector('p')!.lastChild!;
  const range = document.createRange(); range.setStart(node, 2); range.setEnd(node, 4);
  const selection = readConceptSelection(root, range)!;
  expect(selection.text).toBe('残差');
  expect(findConceptRange(root, selection)?.toString()).toBe('残差');
});
test("trims a selection without losing the spaces surrounding its anchor", () => {
  document.body.innerHTML = '<article><p>解释 残差 的作用。</p></article>';
  const root = document.querySelector('article')!;
  const range = document.createRange(); range.setStart(root.querySelector('p')!.firstChild!, 2); range.setEnd(root.querySelector('p')!.firstChild!, 6);
  expect(findConceptRange(root, readConceptSelection(root, range)!)?.toString()).toBe('残差');
});
test("restores legacy contexts including code, formulas and originally selected spaces", () => {
  document.body.innerHTML = '<article><p>模型 <code>y=x</code><span class="katex">formula</span> 中 残差 是差值。</p></article>';
  const root = document.querySelector('article')!;
  expect(findConceptRange(root, { text: '残差', sentence: '模型 y=xformula 中 残差 是差值。', prefix: '模型 y=xformula 中', suffix: '是差值。' })?.toString()).toBe('残差');
  expect(findConceptRange(root, { text: '残差', sentence: '已修改的内容', prefix: '错误语境', suffix: '是差值。' })).toBeNull();
});
test("uses the Kimi/DeepSeek paragraph context rather than the whole assistant wrapper", () => {
  for (const className of ['paragraph', 'ds-markdown-paragraph']) {
    document.body.innerHTML = `<article><div>网页工具信息</div><div class="${className}">残差是差值。</div><div>网页操作信息</div></article>`;
    const root = document.querySelector('article')!; const range = document.createRange(); const node = root.querySelector(`.${className}`)!.firstChild!;
    range.setStart(node, 0); range.setEnd(node, 2);
    expect(readConceptSelection(root, range)).toEqual({ text: '残差', sentence: '残差是差值。', prefix: '', suffix: '是差值。' });
  }
});
test("focuses in place, cancels on outside click and generates only on a second click", async () => {
  document.body.innerHTML = "<article><p>第一句话。残差是观测值与预测值之差。</p></article><aside>其他区域</aside>";
  const original = document.querySelector("article")!.innerHTML;
  const generate = vi.fn();
  const controller = new ConceptSelectionController(document, (node) => document.querySelector("article")!.contains(node) ? document.querySelector("article") : null, generate, vi.fn());
  const { root, range } = select();
  expect(readConceptSelection(root, range)?.sentence).toBe("残差是观测值与预测值之差。");
  root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  expect(document.querySelector('[aria-label="生成概念：残差"]')).not.toBeNull();
  expect(generate).not.toHaveBeenCalled();
  await new Promise((resolve) => setTimeout(resolve, 1));
  document.querySelector("aside")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(document.querySelector(".concept-range-chip")).toBeNull();
  select(); root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
  document.querySelector(".concept-range-chip")!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(generate).toHaveBeenCalledWith(root, expect.objectContaining({ text: "残差", sentence: "残差是观测值与预测值之差。" }));
  expect(root.cloneNode(true).textContent).toBe("第一句话。残差是观测值与预测值之差。");
  controller.destroy();
  expect(root.innerHTML).toBe(original);
});

test("anchors chips inside their text root so scrolling and dragging move them without repainting", () => {
  document.body.innerHTML = '<article style="overflow:auto"><p>第一句话。残差是观测值与预测值之差。</p></article>';
  const { root, range } = select();
  const bounds = vi.spyOn(root, "getBoundingClientRect").mockReturnValue({ left: 10, top: 10, width: 200, height: 100 } as DOMRect);
  const controller = new ConceptSelectionController(document, () => root, vi.fn(), vi.fn());
  controller.setMarks([{ root, mark: { id: "note", selection: readConceptSelection(root, range)! } }]);
  const chip = root.querySelector<HTMLButtonElement>(".concept-range-chip")!;
  expect(chip).not.toBeNull();
  expect(chip.style.position).toBe("absolute");
  expect(chip.style.left).toBe("8px");
  const left = chip.style.left;
  bounds.mockReturnValue({ left: 80, top: 100, width: 200, height: 100 } as DOMRect);
  root.scrollTop = 30;
  root.dispatchEvent(new Event("scroll", { bubbles: true }));
  expect(root.querySelector(".concept-range-chip")).toBe(chip);
  expect(chip.style.left).toBe(left);
  controller.destroy();
  expect(root.style.position).toBe("");
});

test("native text highlights are isolated between readers and cleaned up with each controller", () => {
  const highlights = new Map<string, unknown>();
  vi.stubGlobal("CSS", { highlights });
  vi.stubGlobal("Highlight", class { constructor(...ranges: Range[]) { expect(ranges.every((range) => range instanceof Range)).toBe(true); } });
  document.body.innerHTML = '<article><p>第一句话。残差是观测值与预测值之差。</p></article><article><p>另一份笔记。</p></article>';
  const { root, range } = select();
  const second = document.querySelectorAll('article')[1]!;
  const firstController = new ConceptSelectionController(document, () => root, vi.fn(), vi.fn());
  const secondController = new ConceptSelectionController(document, () => second, vi.fn(), vi.fn());
  firstController.setMarks([{ root, mark: { id: 'first', selection: readConceptSelection(root, range)! } }]);
  secondController.setMarks([{ root: second, mark: { id: 'second', selection: { text: '笔记', sentence: '另一份笔记。', prefix: '另一份', suffix: '。' } } }]);
  expect(highlights.size).toBe(6);
  expect(root.querySelector('.concept-overlays')).toHaveProperty('dataset.native', 'true');
  firstController.destroy();
  expect(highlights.size).toBe(3);
  expect(second.querySelector('.concept-range-chip')).not.toBeNull();
  secondController.destroy();
  expect(highlights.size).toBe(0);
});
test("restores a unique quote and declines an ambiguous or changed one", () => {
  document.body.innerHTML = "<article><p>残差是差值。</p><p>残差是差值。</p></article>";
  const root = document.querySelector("article")!;
  expect(findConceptRange(root, { text: "残差", sentence: "残差是差值。", prefix: "", suffix: "是差值。" })).toBeNull();
  root.querySelector("p")!.textContent = "残差表示第一种差值。";
  expect(findConceptRange(root, { text: "残差", sentence: "残差是差值。", prefix: "", suffix: "是差值。" })?.toString()).toBe("残差");
  expect(findConceptRange(root, { text: "不存在", sentence: "不存在", prefix: "", suffix: "" })).toBeNull();
});

test("one outside click clears native selection while completed concept chips stay rounded and openable", () => {
  document.body.innerHTML = '<article><p>第一句话。残差是观测值与预测值之差。</p></article><aside>其他区域</aside>';
  const open = vi.fn();
  const controller = new ConceptSelectionController(document, (node) => document.querySelector('article')!.contains(node) ? document.querySelector('article') : null, vi.fn(), open);
  const { root, range } = select();
  controller.setMarks([{ root, mark: { id: 'concept-note', selection: readConceptSelection(root, range)! } }]);
  document.querySelector('aside')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  document.querySelector('aside')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(document.getSelection()!.rangeCount).toBe(0);
  const chip = document.querySelector<HTMLButtonElement>('[aria-label="打开概念：残差"]')!;
  expect(getComputedStyle(chip).borderRadius).toBe('12px');
  chip.click(); expect(open).toHaveBeenCalledWith('concept-note');
  expect(document.querySelector('[aria-label="打开概念：残差"]')).not.toBeNull();
  controller.destroy();
});

test("outside mouseup does not treat a leftover native range as a fresh selection", async () => {
  document.body.innerHTML = '<article><p>第一句话。残差是观测值与预测值之差。</p></article><aside>其他区域</aside>';
  const controller = new ConceptSelectionController(document, (node) => document.querySelector('article')!.contains(node) ? document.querySelector('article') : null, vi.fn(), vi.fn());
  const { root } = select(); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  await new Promise((resolve) => setTimeout(resolve, 1));
  select();
  const outside = document.querySelector('aside')!;
  outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  outside.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(document.getSelection()!.rangeCount).toBe(0);
  expect(document.querySelector('.concept-range-chip')).toBeNull();
  controller.destroy();
});

test("reanchors marks when the source DOM is replaced and supports a separate question action", async () => {
  document.body.innerHTML = '<article><p>第一句话。残差是观测值与预测值之差。</p></article>';
  const { root, range } = select(); const selection = readConceptSelection(root, range)!;
  const ask = vi.fn(); const open = vi.fn();
  const controller = new ConceptSelectionController(document, () => root, vi.fn(), open, { onAsk: ask });
  controller.setMarks([{ root, mark: { id: 'concept-note', selection } }, { root, mark: { id: 'qa-note', selection, kind: 'qa' } }]);
  root.innerHTML = '<p>第一句话。<strong>残差</strong>是观测值与预测值之差。</p>';
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(root.querySelector('[aria-label="打开概念：残差"]')).not.toBeNull();
  const annotation = root.querySelector<HTMLButtonElement>('[aria-label="打开答疑：残差"]')!;
  expect(getComputedStyle(annotation).borderBottomColor).toBe('rgb(7, 155, 145)');
  annotation.click(); expect(open).toHaveBeenCalledWith('qa-note');
  const fresh = findConceptRange(root, selection)!;
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(fresh); root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  root.querySelector<HTMLButtonElement>('.selection-ask-button')!.click();
  expect(ask).toHaveBeenCalledWith(root, selection);
  expect(root.querySelector('.selection-ask-button')).toBeNull();
  controller.destroy();
});

test("keeps stored concept marks openable in a read-only reader", () => {
  document.body.innerHTML = '<article><p>第一句话。残差是观测值与预测值之差。</p></article>';
  const { root, range } = select(); const open = vi.fn(); const generate = vi.fn();
  const controller = new ConceptSelectionController(document, () => root, generate, open, { readOnly: true, onAsk: vi.fn() });
  controller.setMarks([{ root, mark: { id: 'note', selection: readConceptSelection(root, range)! } }]);
  root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
  expect(root.querySelector('.selection-ask-button')).toBeNull();
  root.querySelector<HTMLButtonElement>('.concept-range-chip')!.click();
  expect(open).toHaveBeenCalledWith('note'); expect(generate).not.toHaveBeenCalled();
  controller.destroy();
});
