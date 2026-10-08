import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { safeLink } from "../shared/content.js";

// Only Doubao and Yuanbao use these rules. ChatGPT's converter stays unchanged.
export function replaceMath(element: Element, tex: string, display: boolean): void {
  const marker = element.ownerDocument.createElement(display ? "div" : "span");
  marker.setAttribute("data-answer-math", display ? "block" : "inline");
  marker.setAttribute("data-answer-tex", tex.trim());
  marker.textContent = tex.trim();
  element.replaceWith(marker);
}

export function replaceCode(element: Element, source: Element, language = ""): void {
  const pre = element.ownerDocument.createElement("pre");
  const code = element.ownerDocument.createElement("code");
  const detected = source.className.match(/language-([\w+-]+)/)?.[1] ?? language;
  code.className = /^[\w+-]+$/.test(detected) ? `language-${detected}` : "";
  code.textContent = source.textContent;
  pre.append(code);
  element.replaceWith(pre);
}

export function resolveAnswerUrl(value: string, sourceUrl: string): string {
  if (!value.trim()) return "";
  try { return safeLink(new URL(value, sourceUrl).href); } catch { return ""; }
}

function normalizeMath(root: Element): void {
  root.querySelectorAll(".katex-display, mjx-container[display='true'], .katex, mjx-container").forEach((element) => {
    if (!root.contains(element)) return;
    const tex = element.getAttribute("data-tex")
      ?? element.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex) replaceMath(element, tex, element.matches(".katex-display, mjx-container[display='true']"));
  });
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  for (const node of nodes) {
    if (node.parentElement?.closest("pre,code,[data-answer-math]")) continue;
    const value = node.textContent ?? "";
    const fragment = root.ownerDocument.createDocumentFragment();
    let offset = 0;
    for (const match of value.matchAll(/(?<!\\)\\\(([\s\S]*?)\\\)|(?<!\\)\\\[([\s\S]*?)\\\]/g)) {
      fragment.append(value.slice(offset, match.index));
      const marker = root.ownerDocument.createElement(match[1] === undefined ? "div" : "span");
      marker.setAttribute("data-answer-math", match[1] === undefined ? "block" : "inline");
      marker.setAttribute("data-answer-tex", (match[1] ?? match[2]).trim());
      marker.textContent = (match[1] ?? match[2]).trim();
      fragment.append(marker);
      offset = match.index + match[0].length;
    }
    if (offset) { fragment.append(value.slice(offset)); node.replaceWith(fragment); }
  }
}

function normalizeTasks(root: Element): void {
  root.querySelectorAll('input[type="checkbox"], [role="checkbox"]').forEach((element) => {
    if (!element.closest("li")) return;
    const marker = root.ownerDocument.createElement("span");
    marker.setAttribute("data-answer-task", (element as HTMLInputElement).checked || element.getAttribute("aria-checked") === "true" ? "x" : " ");
    marker.textContent = "task";
    element.replaceWith(marker);
  });
  root.querySelectorAll("li").forEach((item) => {
    if (item.querySelector(":scope > [data-answer-task]")) return;
    const walker = root.ownerDocument.createTreeWalker(item, NodeFilter.SHOW_TEXT);
    let node: Text | null = null;
    while (walker.nextNode()) {
      if (walker.currentNode.textContent?.trim()) { node = walker.currentNode as Text; break; }
    }
    const match = node?.textContent?.match(/^\s*\[([ xX])\]\s*/);
    if (!match || !node) return;
    node.textContent = node.textContent!.slice(match[0].length);
    const marker = root.ownerDocument.createElement("span");
    marker.setAttribute("data-answer-task", match[1].toLowerCase());
    marker.textContent = "task";
    node.before(marker);
  });
}

export function serializeAnswer(root: Element, sourceUrl: string): string {
  normalizeMath(root);
  normalizeTasks(root);
  root.querySelectorAll('a[data-footnote-ref], a[role="doc-noteref"]').forEach((link) => {
    const id = link.getAttribute("href")?.match(/^#(?:user-content-)?fn-?(.+)$/)?.[1];
    if (!id || !/^[\w-]+$/.test(id)) return;
    const marker = root.ownerDocument.createElement("span");
    marker.setAttribute("data-answer-literal", "true");
    marker.textContent = `[^${id}]`;
    (link.parentElement?.tagName === "SUP" ? link.parentElement : link).replaceWith(marker);
  });
  root.querySelectorAll('section[data-footnotes] li[id], .footnotes li[id]').forEach((item) => {
    const id = item.id.replace(/^(?:user-content-)?fn-?/, "");
    if (!/^[\w-]+$/.test(id)) return;
    item.querySelectorAll('[data-footnote-backref], [role="doc-backlink"]').forEach((element) => element.remove());
    item.setAttribute("data-answer-footnote", id);
  });
  root.querySelectorAll("a").forEach((link) => {
    const href = resolveAnswerUrl(link.getAttribute("href") ?? "", sourceUrl);
    if (href) link.setAttribute("href", href); else link.replaceWith(...link.childNodes);
  });
  root.querySelectorAll("img").forEach((image) => {
    const src = ["src", "data-src", "data-original"].map((attribute) => resolveAnswerUrl(image.getAttribute(attribute) ?? "", sourceUrl)).find((url) => url.startsWith("https:"));
    if (src) image.setAttribute("src", src);
    else image.replaceWith(root.ownerDocument.createTextNode(image.getAttribute("alt") ?? ""));
  });
  root.querySelectorAll("button").forEach((button) => {
    if (button.querySelector("img")) button.replaceWith(...button.childNodes);
  });
  root.querySelectorAll("script,style,button,svg,iframe,object,embed,.mindmap-ai-capture-badge").forEach((element) => element.remove());
  const turndown = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", emDelimiter: "_", strongDelimiter: "**" });
  turndown.use(gfm);
  const escape = turndown.escape.bind(turndown);
  // Ordinary prices must not turn into a formula between two dollar signs.
  turndown.escape = (text) => escape(text).replace(/\$/g, "\\$");
  turndown.addRule("strike", { filter: (node) => node.matches("del,s,strike"), replacement: (content) => `~~${content}~~` });
  turndown.addRule("linkedImage", {
    filter: (node) => node.nodeName === "A" && Boolean(node.querySelector("img")),
    replacement: (content, node) => `[${content.trim().replace(/\n\s*/g, "")}](${node.getAttribute("href")})`
  });
  turndown.addRule("task", {
    filter: (node) => node.hasAttribute("data-answer-task"),
    replacement: (_content, node) => `[${node.getAttribute("data-answer-task")}] `
  });
  turndown.addRule("literal", {
    filter: (node) => node.hasAttribute("data-answer-literal"),
    replacement: (_content, node) => node.textContent ?? ""
  });
  turndown.addRule("footnote", {
    filter: (node) => node.hasAttribute("data-answer-footnote"),
    replacement: (content, node) => `\n\n[^${node.getAttribute("data-answer-footnote")}]: ${content.trim().replace(/\n/g, "\n    ")}\n\n`
  });
  turndown.addRule("footnoteList", {
    filter: (node) => node.nodeName === "OL" && Boolean(node.querySelector("[data-answer-footnote]")),
    replacement: (content) => content
  });
  turndown.addRule("math", {
    filter: (node) => node.hasAttribute("data-answer-math"),
    replacement: (_content, node) => node.getAttribute("data-answer-math") === "block"
      ? `\n\n$$\n${node.getAttribute("data-answer-tex")}\n$$\n\n` : `$${node.getAttribute("data-answer-tex")}$`
  });
  turndown.addRule("code", {
    filter: (node) => node.nodeName === "PRE" && node.firstElementChild?.nodeName === "CODE",
    replacement: (_content, node) => {
      const code = node.firstElementChild!;
      const text = code.textContent?.replace(/\n$/, "") ?? "";
      const language = code.className.match(/language-([\w+-]+)/)?.[1] ?? "";
      const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
  });
  turndown.addRule("cell", {
    filter: ["th", "td"],
    replacement: (content) => ` ${content.trim().replace(/(?<!\\)\|/g, "\\|").replace(/ *\n+ */g, "<br>")} |`
  });
  turndown.addRule("row", {
    filter: "tr",
    replacement: (content, node) => {
      const cells = [...node.children].filter((child) => child.matches("th,td"));
      const heading = cells.length > 0 && cells.every((cell) => cell.nodeName === "TH");
      const border = heading ? `\n|${cells.map((cell) => {
        const align = cell.getAttribute("align") ?? (cell as HTMLElement).style.textAlign;
        return ` ${({ left: ":---", center: ":---:", right: "---:" } as Record<string, string>)[align] ?? "---"} |`;
      }).join("")}` : "";
      return `\n|${content}${border}`;
    }
  });
  turndown.addRule("table", {
    filter: "table",
    replacement: (content, node) => {
      const first = node.querySelector("tr");
      const cells = first ? [...first.children].filter((cell) => cell.matches("th,td")) : [];
      const header = cells.some((cell) => cell.nodeName === "TD")
        ? `|${"  |".repeat(cells.length)}\n|${" --- |".repeat(cells.length)}\n` : "";
      return `\n\n${header}${content.trim()}\n\n`;
    }
  });
  return turndown.turndown(root.innerHTML).trim();
}
