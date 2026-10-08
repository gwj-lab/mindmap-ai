import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { extractSingleTitle } from "./title-extraction.js";

export function extractTitle(markdown: string): string {
  return extractSingleTitle(markdown);
}

export async function contentHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readTex(element: Element): string {
  return element.getAttribute("data-tex")
    ?? element.querySelector('annotation[encoding="application/x-tex"]')?.textContent
    ?? element.textContent
    ?? "";
}

export function htmlToMarkdown(root: Element): string {
  const clone = root.cloneNode(true) as Element;
  // Current ChatGPT uses semantic copy markers instead of pre/code for its panes.
  // Normalize before removing toolbars so the language and exact whitespace survive.
  clone.querySelectorAll('[data-markdown-copy="code-block"]').forEach((element) => {
    const source = element.querySelector("code");
    if (!source) return;
    const label = element.querySelector('[data-markdown-copy="exclude"] .truncate')?.textContent?.trim() ?? "";
    const language = source.className.match(/language-([\w+-]+)/)?.[1]
      ?? ({ JavaScript: "javascript", Python: "python", "纯文本": "text", "Plain text": "text" } as Record<string, string>)[label]
      ?? (/^[\w+-]+$/.test(label) ? label.toLowerCase() : "");
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.className = language ? `language-${language}` : "";
    code.textContent = source.textContent;
    pre.append(code);
    element.replaceWith(pre);
  });
  clone.querySelectorAll('[data-markdown-copy="inline-code"]').forEach((element) => {
    const code = document.createElement("code");
    code.textContent = element.textContent;
    element.replaceWith(code);
  });
  clone.querySelectorAll('button[data-message-image]').forEach((element) => {
    element.replaceWith(...element.childNodes);
  });
  clone.querySelectorAll('[role="checkbox"]').forEach((element) => {
    const marker = document.createElement("span");
    marker.setAttribute("data-mindmap-task", element.getAttribute("aria-checked") === "true" ? "checked" : "unchecked");
    marker.textContent = "task";
    const container = element.parentElement?.getAttribute("data-markdown-copy") === "contents" ? element.parentElement : element;
    container.replaceWith(marker);
  });
  clone.querySelectorAll('a[data-testid="chatgpt-citation"]').forEach((element) => {
    element.setAttribute("title", "chatgpt-source");
    element.querySelectorAll("svg").forEach((icon) => icon.remove());
    element.querySelectorAll("img").forEach((icon) => {
      if (!safeLink(icon.getAttribute("src") ?? "")) icon.remove();
    });
  });
  clone.querySelectorAll("script,style,button,.agent-chat__toolbar,[data-markdown-copy='exclude'],[data-testid*='copy'],[aria-label*='Copy'],[aria-label*='复制']")
    .forEach((element) => element.remove());

  clone.querySelectorAll(".katex-display, mjx-container[display='true']").forEach((element) => {
    const marker = document.createElement("div");
    marker.setAttribute("data-mindmap-math", "block");
    marker.textContent = readTex(element);
    element.replaceWith(marker);
  });
  clone.querySelectorAll(".katex, mjx-container:not([display='true'])").forEach((element) => {
    const marker = document.createElement("span");
    marker.setAttribute("data-mindmap-math", "inline");
    marker.textContent = readTex(element);
    element.replaceWith(marker);
  });

  // Server-rendered replies can contain TeX before the page's lazy math renderer
  // loads. Recover those delimiters before Turndown escapes the backslashes.
  const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    if (node.parentElement?.closest("pre,code,[data-mindmap-math]")) continue;
    const value = node.textContent ?? "";
    const pattern = /(?<!\\)\\\(([\s\S]*?)\\\)|(?<!\\)\\\[([\s\S]*?)\\\]/g;
    let start = 0;
    const fragment = document.createDocumentFragment();
    for (const match of value.matchAll(pattern)) {
      fragment.append(value.slice(start, match.index));
      const marker = document.createElement("span");
      marker.setAttribute("data-mindmap-math", match[1] === undefined ? "block" : "inline");
      marker.textContent = (match[1] ?? match[2]).trim();
      fragment.append(marker);
      start = match.index + match[0].length;
    }
    if (start) {
      fragment.append(value.slice(start));
      node.replaceWith(fragment);
    }
  }

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    strongDelimiter: "**"
  });
  turndown.use(gfm);
  turndown.addRule("taskMarker", {
    filter: (node) => node.hasAttribute("data-mindmap-task"),
    replacement: (_content, node) => node.getAttribute("data-mindmap-task") === "checked" ? "[x] " : "[ ] "
  });
  turndown.addRule("math", {
    filter: (node) => node.hasAttribute("data-mindmap-math"),
    replacement: (_content, node) => {
      const tex = node.textContent ?? "";
      return node.getAttribute("data-mindmap-math") === "block"
        ? `\n\n$$${tex}$$\n\n`
        : `$${tex}$`;
    }
  });
  turndown.addRule("languageFence", {
    filter: (node) => node.nodeName === "PRE" && node.firstElementChild?.nodeName === "CODE",
    replacement: (_content, node) => {
      const code = node.firstElementChild as HTMLElement;
      const language = code.className.match(/language-([\w+-]+)/)?.[1] ?? "";
      const text = code.textContent?.replace(/\n$/, "") ?? "";
      const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/`+/g)].map((match) => match[0].length + 1)));
      return `\n\n${fence}${language}\n${text}\n${fence}\n\n`;
    }
  });
  return turndown.turndown(clone.innerHTML).trim();
}

export function safeLink(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "mailto:" ? parsed.href : "";
  } catch {
    return "";
  }
}
