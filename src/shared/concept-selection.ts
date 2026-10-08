import { sentenceAt, type ConceptSelection } from "./concepts.js";

export interface ConceptMark { id: string; selection: ConceptSelection; pending?: boolean }
const excluded = "pre,code,.katex,button,input,textarea,svg,[data-concept-overlay],.mindmap-ai-capture-badge";

function textNodes(root: Element): Text[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest(excluded)) nodes.push(node);
  }
  return nodes;
}
function blockFor(node: Node, root: Element): Element {
  return (node instanceof Element ? node : node.parentElement)?.closest("p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,.ybc-p,[class*='container-enL']") ?? root;
}
export function readConceptSelection(root: Element, range: Range): ConceptSelection | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  if ((range.startContainer.parentElement?.closest(excluded)) || range.cloneContents().querySelector(excluded)) return null;
  const text = range.toString().trim();
  if (!text || text.length > 160) return null;
  const block = blockFor(range.startContainer, root);
  if (!block.contains(range.endContainer)) return null;
  const before = range.cloneRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  const blockText = block.textContent ?? "";
  const offset = before.toString().length;
  const sentence = sentenceAt(blockText, offset, offset + range.toString().length);
  return { text, sentence, prefix: blockText.slice(Math.max(0, offset - 80), offset), suffix: blockText.slice(offset + range.toString().length, offset + range.toString().length + 80) };
}
export function findConceptRange(root: Element, selection: ConceptSelection): Range | null {
  const nodes = textNodes(root);
  const text = nodes.map((node) => node.textContent).join("");
  let index = text.indexOf(selection.text);
  const matches: number[] = [];
  while (index >= 0) {
    const prefix = text.slice(Math.max(0, index - selection.prefix.length), index);
    const suffix = text.slice(index + selection.text.length, index + selection.text.length + selection.suffix.length);
    if ((!selection.prefix || prefix.endsWith(selection.prefix)) && (!selection.suffix || suffix.startsWith(selection.suffix))) matches.push(index);
    index = text.indexOf(selection.text, index + selection.text.length);
  }
  if (matches.length !== 1) return null;
  const start = matches[0]!;
  const range = root.ownerDocument.createRange();
  let offset = 0;
  let started = false;
  for (const node of nodes) {
    const length = node.textContent?.length ?? 0;
    if (!started && start < offset + length) { range.setStart(node, start - offset); started = true; }
    if (started && start + selection.text.length <= offset + length) { range.setEnd(node, start + selection.text.length - offset); return range; }
    offset += length;
  }
  return null;
}

// Range overlays keep the original DOM, formula rendering and Markdown untouched.
export class ConceptSelectionController {
  #focus: { root: Element; range: Range; selection: ConceptSelection } | null = null;
  #marks: Array<{ root: Element; mark: ConceptMark }> = [];
  #overlay: HTMLDivElement;
  #ignoreClick = false;
  #disposed = false;
  #resize: ResizeObserver;
  constructor(private readonly documentRef: Document, private readonly rootAt: (target: Node) => Element | null,
    private readonly onGenerate: (root: Element, selection: ConceptSelection) => void,
    private readonly onOpen: (id: string) => void) {
    this.#overlay = documentRef.createElement("div");
    this.#overlay.dataset.conceptOverlay = "true";
    this.#overlay.className = "concept-overlays";
    this.#overlay.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483646";
    documentRef.body.append(this.#overlay);
    const style = documentRef.createElement("style");
    style.textContent = '.concept-range-chip{position:fixed;pointer-events:auto;border:1px solid #83b5ac;border-radius:12px;background:#cfeee52b;box-shadow:0 1px 3px #17343a22;cursor:pointer;padding:0;color:transparent}.concept-range-chip:hover{background:#9fe0cd55}.concept-range-chip[data-ready="true"]{border:0;border-radius:3px;border-bottom:2px solid #299885;background:#bdebdc22}.concept-range-chip[data-pending="true"]{border-style:dashed;cursor:wait}';
    this.#overlay.append(style);
    documentRef.addEventListener("mouseup", this.#up);
    documentRef.addEventListener("click", this.#click, true);
    documentRef.addEventListener("keydown", this.#key);
    documentRef.addEventListener("scroll", this.#paint, true);
    documentRef.defaultView?.addEventListener("resize", this.#paint);
    this.#resize = new ResizeObserver(this.#paint);
    this.#resize.observe(documentRef.body);
  }
  setMarks(marks: Array<{ root: Element; mark: ConceptMark }>): void { this.#marks = marks; this.#paint(); }
  focus(root: Element, selection: ConceptSelection): boolean {
    const range = findConceptRange(root, selection);
    if (!range) return false;
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
    this.#focus = { root, range, selection }; this.#paint(); return true;
  }
  #up = (event: MouseEvent): void => {
    if (event.button !== 0 || (event.target as Element)?.closest?.("[data-concept-overlay]")) return;
    const selection = this.documentRef.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0).cloneRange();
    const root = this.rootAt(range.startContainer);
    const selected = root && readConceptSelection(root, range);
    if (!root || !selected) return;
    this.#focus = { root, range, selection: selected };
    selection.removeAllRanges();
    this.#ignoreClick = true;
    this.documentRef.defaultView?.setTimeout(() => { this.#ignoreClick = false; }, 0);
    this.#paint();
  };
  #click = (event: MouseEvent): void => {
    const button = (event.target as Element)?.closest?.<HTMLButtonElement>(".concept-range-chip");
    if (button && this.#overlay.contains(button)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (button.dataset.ready === "true") this.onOpen(button.dataset.id!);
      else if (this.#focus && !button.dataset.pending) {
        const selected = this.#focus; this.#focus = null; this.#paint(); this.onGenerate(selected.root, selected.selection);
      }
      return;
    }
    if (!this.#ignoreClick) { this.#focus = null; this.#paint(); }
  };
  #key = (event: KeyboardEvent): void => { if (event.key === "Escape") { this.#focus = null; this.#paint(); } };
  #paint = (): void => {
    if (this.#disposed) return;
    this.#overlay.querySelectorAll("button").forEach((button) => button.remove());
    const draw = (range: Range, text: string, id?: string, pending = false): void => {
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > (this.documentRef.defaultView?.innerHeight ?? 0)) continue;
        const button = this.documentRef.createElement("button");
        button.className = "concept-range-chip";
        button.setAttribute("aria-label", `${id ? pending ? "概念生成中" : "打开概念" : "生成概念"}：${text}`);
        button.title = id ? pending ? "概念正在生成" : "打开概念笔记" : "再次点击生成概念，点击其他位置取消";
        if (id) { button.dataset.id = id; button.dataset.ready = String(!pending); }
        if (pending) button.dataset.pending = "true";
        button.style.cssText = `left:${rect.left - 2}px;top:${rect.top - 1}px;width:${rect.width + 4}px;height:${rect.height + 2}px`;
        this.#overlay.append(button);
      }
    };
    for (const { root, mark } of this.#marks) {
      if (!root.isConnected) continue;
      const range = findConceptRange(root, mark.selection);
      if (range) draw(range, mark.selection.text, mark.id, mark.pending);
    }
    if (this.#focus?.root.isConnected) draw(this.#focus.range, this.#focus.selection.text);
  };
  destroy(): void {
    this.#disposed = true; this.#resize.disconnect(); this.#overlay.remove();
    this.documentRef.removeEventListener("mouseup", this.#up); this.documentRef.removeEventListener("click", this.#click, true);
    this.documentRef.removeEventListener("keydown", this.#key); this.documentRef.removeEventListener("scroll", this.#paint, true);
    this.documentRef.defaultView?.removeEventListener("resize", this.#paint);
  }
}
