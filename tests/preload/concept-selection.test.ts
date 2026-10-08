// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConceptSelectionController, findConceptRange, readConceptSelection } from "../../src/shared/concept-selection.js";
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
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
  expect(root.innerHTML).toBe(original);
  controller.destroy();
});
test("restores a unique quote and declines an ambiguous or changed one", () => {
  document.body.innerHTML = "<article><p>残差是差值。</p><p>残差是差值。</p></article>";
  const root = document.querySelector("article")!;
  expect(findConceptRange(root, { text: "残差", sentence: "残差是差值。", prefix: "", suffix: "是差值。" })).toBeNull();
  root.querySelector("p")!.textContent = "残差表示第一种差值。";
  expect(findConceptRange(root, { text: "残差", sentence: "残差是差值。", prefix: "", suffix: "是差值。" })?.toString()).toBe("残差");
  expect(findConceptRange(root, { text: "不存在", sentence: "不存在", prefix: "", suffix: "" })).toBeNull();
});
