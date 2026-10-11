import { QUESTION_SELECTION_LIMIT, sentenceAt, type ConceptSelection } from "./concepts.js";

export interface ConceptMark { id: string; selection: ConceptSelection; pending?: boolean; kind?: "qa" }
const excluded = "pre,code,.katex,button,input,textarea,svg,[data-concept-overlay],.mindmap-ai-capture-badge";
const questionExcluded = "button,input,textarea,svg,[data-concept-overlay],.mindmap-ai-capture-badge";

function textNodes(root: Node, omit = excluded): Text[] {
  const walker = root.ownerDocument!.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.parentElement?.closest(omit)) nodes.push(node);
  }
  return nodes;
}
function blockFor(node: Node, root: Element): Element {
  return (node instanceof Element ? node : node.parentElement)?.closest("p,li,td,th,h1,h2,h3,h4,h5,h6,blockquote,.paragraph,.ds-markdown-paragraph,.ybc-p,[class*='container-enL']") ?? root;
}
export function readConceptSelection(root: Element, range: Range): ConceptSelection | null {
  return readSelection(root, range, false);
}
export function readQuestionSelection(root: Element, range: Range): ConceptSelection | null {
  return readSelection(root, range, true);
}
function readSelection(root: Element, range: Range, question: boolean): ConceptSelection | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const omit = question ? questionExcluded : excluded;
  if ((range.startContainer.parentElement?.closest(omit)) || range.cloneContents().querySelector(omit)) return null;
  const text = range.toString().trim();
  if (!text || text.length > (question ? QUESTION_SELECTION_LIMIT : 160)) return null;
  let block = blockFor(range.startContainer, root);
  if (!block.contains(range.endContainer)) { if (!question) return null; block = root; }
  const before = range.cloneRange();
  before.selectNodeContents(block);
  before.setEnd(range.startContainer, range.startOffset);
  const blockText = textNodes(block, omit).map((node) => node.data).join("");
  const offset = textNodes(before.cloneContents(), omit).map((node) => node.data).join("").length + range.toString().indexOf(text);
  const end = offset + text.length;
  const sentence = sentenceAt(blockText, offset, end);
  if (sentence.length > (question ? 24000 : 12000)) return null;
  return { text, sentence, prefix: blockText.slice(Math.max(0, offset - 80), offset), suffix: blockText.slice(end, end + 80) };
}
export function findConceptRange(root: Element, selection: ConceptSelection): Range | null {
  return rangeInNodes(root, textNodes(root), selection) ?? rangeInNodes(root, textNodes(root, questionExcluded), selection);
}
// The second text stream restores older anchors whose context included code/math.
function rangeInNodes(root: Element, nodes: Text[], selection: ConceptSelection): Range | null {
  const text = nodes.map((node) => node.textContent).join("");
  let index = text.indexOf(selection.text);
  const matches: number[] = [];
  while (index >= 0) {
    const prefix = text.slice(Math.max(0, index - selection.prefix.length - 160), index);
    const suffix = text.slice(index + selection.text.length, index + selection.text.length + selection.suffix.length + 160);
    // Older selections trimmed the quote but left their context outside the
    // original spaces. Accept only whitespace differences, still uniquely.
    if ((!selection.prefix || prefix.endsWith(selection.prefix) || prefix.trimEnd().endsWith(selection.prefix.trimEnd())) && (!selection.suffix || suffix.startsWith(selection.suffix) || suffix.trimStart().startsWith(selection.suffix.trimStart()))) matches.push(index);
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
    if (started && start + selection.text.length <= offset + length) {
      range.setEnd(node, start + selection.text.length - offset);
      return range;
    }
    offset += length;
  }
  return null;
}

let controllerId = 0;
interface HighlightView {
  CSS?: { highlights?: { set(name: string, value: unknown): void; delete(name: string): void } };
  Highlight?: new (...ranges: Range[]) => unknown;
}

// Text highlights and hit targets share the text's scrolling coordinate system.
export class ConceptSelectionController {
  #focus: { root: Element; range: Range; selection: ConceptSelection; questionOnly?: boolean } | null = null;
  #marks: Array<{ root: Element; mark: ConceptMark }> = [];
  #layers = new Map<Element, { element: HTMLDivElement; position: string; priority: string; patched: boolean }>();
  #style: HTMLStyleElement;
  #highlightView: HighlightView;
  #name = `mindmap-concept-${++controllerId}`;
  #ignoreClick = false;
  #disposed = false;
  #resize: ResizeObserver;
  #mutation: MutationObserver;
  #scheduled: number | undefined;
  constructor(private readonly documentRef: Document, private readonly rootAt: (target: Node) => Element | null,
    private readonly onGenerate: (root: Element, selection: ConceptSelection) => void,
    private readonly onOpen: (id: string) => void,
    private readonly options: { onAsk?: (root: Element, selection: ConceptSelection) => void; readOnly?: boolean; preserveSelection?: boolean } = {}) {
    this.#highlightView = documentRef.defaultView as HighlightView;
    this.#style = documentRef.createElement("style");
    this.#style.textContent = `.concept-overlays .concept-range-chip{position:absolute;pointer-events:auto;border:1px solid #8b6bc466;border-radius:12px;background:#ede5fa88;cursor:pointer;padding:0;color:transparent}.concept-overlays .concept-range-chip:hover{background:#cbb4ee66}.concept-overlays .concept-range-chip[data-pending="true"]{border-style:dashed;cursor:wait}.concept-overlays[data-native="true"] .concept-range-chip{background:transparent}.concept-overlays[data-native="true"] .concept-range-chip:hover{background:#cbb4ee44}::highlight(${this.#name}-ready){background-color:#e6daf7;color:inherit}::highlight(${this.#name}-pending){background-color:#f0e9fa;color:inherit}::highlight(${this.#name}-focus){background-color:#ddcbf5;color:inherit}`;
    documentRef.head.append(this.#style);
    this.#style.textContent += `.concept-overlays .concept-range-chip[data-kind="qa"]{border:0;border-bottom:2px solid #079b91;border-radius:0;background:#0ab9ac18}.concept-overlays .concept-range-chip[data-kind="qa"][data-pending="true"]{border-bottom-style:dashed}.concept-overlays .selection-ask-button{position:absolute;pointer-events:auto;white-space:nowrap;background:#087f79;color:white;border:1px solid #076d68;border-radius:6px;padding:3px 10px;font:12px system-ui;cursor:pointer;box-shadow:0 2px 6px #0002;z-index:2}`;
    documentRef.addEventListener("mouseup", this.#up);
    documentRef.addEventListener("click", this.#click, true);
    documentRef.addEventListener("keydown", this.#key);
    documentRef.defaultView?.addEventListener("resize", this.#paint);
    this.#resize = new ResizeObserver(this.#paint);
    this.#resize.observe(documentRef.body);
    this.#mutation = new MutationObserver((mutations) => {
      if (mutations.some((change) => {
        const target = change.target instanceof Element ? change.target : change.target.parentElement;
        if (target?.closest("[data-concept-overlay]")) return false;
        if (change.type === "childList" && [...change.addedNodes, ...change.removedNodes].every((node) => node instanceof Element && node.matches("[data-concept-overlay]"))) return false;
        return [...this.#layers.keys()].some((root) => root.contains(change.target));
      })) this.#schedule();
    });
    this.#mutation.observe(documentRef.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    documentRef.addEventListener("scroll", this.#scroll, true);
    documentRef.addEventListener("load", this.#schedule, true);
    void documentRef.fonts?.ready.then(this.#schedule);
  }
  #schedule = (): void => {
    if (this.#disposed || this.#scheduled !== undefined) return;
    this.#scheduled = this.documentRef.defaultView?.setTimeout(() => { this.#scheduled = undefined; this.#paint(); }, 0);
  };
  #scroll = (event: Event): void => {
    if ([...this.#layers.keys()].some((root) => event.target instanceof Node && event.target !== root && root.contains(event.target))) this.#schedule();
  };
  setMarks(marks: Array<{ root: Element; mark: ConceptMark }>): void { this.#marks = marks; this.#paint(); }
  focus(root: Element, selection: ConceptSelection): boolean {
    const range = findConceptRange(root, selection);
    if (!range) return false;
    range.startContainer.parentElement?.scrollIntoView({ block: "center" });
    this.#focus = { root, range, selection }; this.#paint(); return true;
  }
  #up = (event: MouseEvent): void => {
    if (this.options.readOnly || event.button !== 0 || (event.target as Element)?.closest?.("[data-concept-overlay]")) return;
    const selection = this.documentRef.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return;
    const range = selection.getRangeAt(0).cloneRange();
    const root = this.rootAt(range.startContainer);
    const concept = root && readConceptSelection(root, range);
    const selected = concept || (root && this.options.onAsk && readQuestionSelection(root, range));
    if (!root || !selected || !(event.target instanceof Node) || !root.contains(event.target)) return;
    this.#focus = { root, range, selection: selected, questionOnly: !concept };
    if (!this.options.preserveSelection) selection.removeAllRanges();
    this.#ignoreClick = true;
    this.documentRef.defaultView?.setTimeout(() => { this.#ignoreClick = false; }, 0);
    this.#paint();
  };
  #click = (event: MouseEvent): void => {
    if (this.options.preserveSelection && (event.target as Element)?.closest?.("[data-preserve-selection]")) return;
    const ask = (event.target as Element)?.closest?.(".selection-ask-button");
    if (ask && [...this.#layers.values()].some((layer) => layer.element.contains(ask)) && this.#focus) {
      event.preventDefault(); event.stopImmediatePropagation();
      const selected = this.#focus; this.#focus = null; this.#paint(); this.options.onAsk?.(selected.root, selected.selection); return;
    }
    const button = (event.target as Element)?.closest?.<HTMLButtonElement>(".concept-range-chip");
    if (button && [...this.#layers.values()].some((layer) => layer.element.contains(button))) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (button.dataset.ready === "true") this.onOpen(button.dataset.id!);
      else if (this.#focus && !this.#focus.questionOnly && !button.dataset.pending) {
        const selected = this.#focus; this.#focus = null; this.#paint(); this.onGenerate(selected.root, selected.selection);
      }
      return;
    }
    if (!this.#ignoreClick) {
      const selection = this.documentRef.getSelection();
      if (this.#focus || (selection?.anchorNode && this.rootAt(selection.anchorNode))) selection?.removeAllRanges();
      this.#focus = null; this.#paint();
    }
  };
  #key = (event: KeyboardEvent): void => { if (event.key === "Escape") { if (this.#focus) this.documentRef.getSelection()?.removeAllRanges(); this.#focus = null; this.#paint(); } };
  #paint = (): void => {
    if (this.#disposed) return;
    const roots = new Set(this.#marks.map(({ root }) => root));
    if (this.#focus) roots.add(this.#focus.root);
    for (const [root, layer] of this.#layers) {
      if (!roots.has(root) || !root.isConnected) { this.#removeLayer(root, layer); continue; }
      if (layer.element.parentElement !== root) root.append(layer.element);
      layer.element.replaceChildren();
    }
    const highlights = { ready: [] as Range[], pending: [] as Range[], focus: [] as Range[] };
    const native = !!this.#highlightView?.Highlight && !!this.#highlightView.CSS?.highlights;
    const draw = (root: Element, range: Range, text: string, id?: string, pending = false, kind?: "qa", questionOnly = false): void => {
      let layer = this.#layers.get(root);
      if (!layer) {
        const element = this.documentRef.createElement("div");
        element.dataset.conceptOverlay = "true";
        element.dataset.native = String(native);
        element.className = "concept-overlays";
        element.style.cssText = "position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;z-index:1";
        const html = root as HTMLElement;
        const position = this.documentRef.defaultView?.getComputedStyle(root).position;
        const patched = !position || position === "static";
        layer = { element, position: html.style.position, priority: html.style.getPropertyPriority("position"), patched };
        if (patched) html.style.setProperty("position", "relative");
        root.append(element);
        this.#layers.set(root, layer);
        this.#resize.observe(root);
      }
      if (!kind) highlights[id ? pending ? "pending" : "ready" : "focus"].push(range);
      const bounds = root.getBoundingClientRect();
      const html = root as HTMLElement;
      for (const rect of range.getClientRects()) {
        if (rect.width < 1 || rect.height < 1) continue;
        const button = this.documentRef.createElement(questionOnly ? "span" : "button");
        button.className = "concept-range-chip";
        if (!questionOnly) button.setAttribute("aria-label", `${kind ? pending ? "答疑生成中" : "打开答疑" : id ? pending ? "概念生成中" : "打开概念" : "生成概念"}：${text}`);
        button.title = kind ? "打开答疑批注" : id ? pending ? "概念正在生成" : "打开概念笔记" : "单击生成概念，或点击答疑";
        if (kind) button.dataset.kind = kind;
        if (id) { button.dataset.id = id; button.dataset.ready = String(kind === "qa" || !pending); }
        if (pending) button.dataset.pending = "true";
        button.style.cssText = `position:absolute;left:${rect.left - bounds.left + root.scrollLeft - html.clientLeft - 2}px;top:${(kind ? rect.bottom - 4 : rect.top - 1) - bounds.top + root.scrollTop - html.clientTop}px;width:${rect.width + 4}px;height:${kind ? 6 : rect.height + 2}px`;
        if (questionOnly) { button.style.pointerEvents = "none"; button.setAttribute("aria-hidden", "true"); button.title = ""; }
        layer.element.append(button);
      }
    };
    for (const { root, mark } of this.#marks) {
      if (!root.isConnected) continue;
      const range = findConceptRange(root, mark.selection);
      if (range) draw(root, range, mark.selection.text, mark.id, mark.pending, mark.kind);
    }
    if (this.#focus?.root.isConnected) {
      const focus = this.#focus;
      const freshRange = findConceptRange(focus.root, focus.selection);
      if (freshRange) focus.range = freshRange;
      const marked = this.#marks.some(({ root, mark }) => root === focus.root && mark.selection.text === focus.selection.text && mark.selection.prefix === focus.selection.prefix && mark.selection.suffix === focus.selection.suffix);
      if (!marked) draw(focus.root, focus.range, focus.selection.text, undefined, false, undefined, focus.questionOnly);
      if (this.options.onAsk && !this.options.readOnly) {
        const rect = focus.range.getClientRects()[0];
        if (rect) {
          // Existing marked words can also receive a separate question.
          if (!this.#layers.has(focus.root)) draw(focus.root, focus.range, focus.selection.text, undefined, false, undefined, focus.questionOnly);
          const button = this.documentRef.createElement("button");
          button.className = "selection-ask-button"; button.textContent = "答疑";
          button.setAttribute("aria-label", `答疑：${focus.selection.text}`);
          const bounds = focus.root.getBoundingClientRect();
          button.style.left = `${Math.max(0, Math.min(rect.left - bounds.left + focus.root.scrollLeft, focus.root.clientWidth - 64))}px`;
          button.style.top = `${rect.bottom - bounds.top + focus.root.scrollTop + 4}px`;
          this.#layers.get(focus.root)!.element.append(button);
        }
      }
    }
    if (native) for (const kind of ["ready", "pending", "focus"] as const) {
      this.#highlightView.CSS!.highlights!.set(`${this.#name}-${kind}`, new this.#highlightView.Highlight!(...highlights[kind]));
    }
  };
  #removeLayer(root: Element, layer: { element: HTMLDivElement; position: string; priority: string; patched: boolean }): void {
    this.#resize.unobserve(root);
    layer.element.remove();
    if (layer.patched) {
      const style = (root as HTMLElement).style;
      if (style.position === "relative") {
        if (layer.position) style.setProperty("position", layer.position, layer.priority);
        else style.removeProperty("position");
      }
    }
    this.#layers.delete(root);
  }
  destroy(): void {
    this.#disposed = true;
    for (const [root, layer] of this.#layers) this.#removeLayer(root, layer);
    this.#resize.disconnect(); this.#style.remove();
    this.#mutation.disconnect(); this.documentRef.defaultView?.clearTimeout(this.#scheduled);
    this.documentRef.removeEventListener("scroll", this.#scroll, true); this.documentRef.removeEventListener("load", this.#schedule, true);
    for (const kind of ["ready", "pending", "focus"]) this.#highlightView?.CSS?.highlights?.delete(`${this.#name}-${kind}`);
    this.documentRef.removeEventListener("mouseup", this.#up); this.documentRef.removeEventListener("click", this.#click, true);
    this.documentRef.removeEventListener("keydown", this.#key);
    this.documentRef.defaultView?.removeEventListener("resize", this.#paint);
  }
}
