import { replaceCode, replaceMath, resolveAnswerUrl, serializeAnswer } from "./answer-markdown.js";

export const doubaoAdapter = {
  messageSelector: '[data-testid="receive_message"], [class*="bg-g-receive-msg-bubble"]',
  content: (message: Element): Element => {
    const parts = [...message.querySelectorAll('[data-testid="message_text_content"]')];
    if (parts.length < 2) return parts[0] ?? message.querySelector('[data-testid="message_content"], .markdown, [class*="markdown-body"]') ?? message;
    const body = message.ownerDocument.createElement("div");
    parts.forEach((part) => body.append(part.cloneNode(true)));
    return body;
  },
  toMarkdown: doubaoToMarkdown
};

export function doubaoToMarkdown(content: Element, sourceUrl: string): string {
  const root = content.cloneNode(true) as Element;
  root.querySelectorAll("div:empty").forEach((element) => {
    if (element.attributes.length === 0) element.replaceWith(root.ownerDocument.createElement("br"));
  });
  const adjacent = (node: Node, direction: "previousSibling" | "nextSibling"): Node | null => {
    let sibling = node[direction];
    while (sibling?.nodeType === Node.TEXT_NODE && !sibling.textContent?.trim()) sibling = sibling[direction];
    return sibling;
  };
  root.querySelectorAll(".math-inline[copy-text], .math-block[copy-text]").forEach((element) => {
    const source = element.getAttribute("copy-text")!.trim();
    const delimited = source.match(/^(?:\\\(([\s\S]*)\\\)|\\\[([\s\S]*)\\\]|\$\$([\s\S]*)\$\$|\$([\s\S]*)\$)$/);
    const tex = delimited ? delimited.slice(1).find((part) => part !== undefined)! : source;
    const before = adjacent(element, "previousSibling");
    const after = adjacent(element, "nextSibling");
    // Doubao uses math-inline even for equations isolated on their own line.
    const alone = !element.closest("td,th") && (!before || (before instanceof Element && before.tagName === "BR")) && (!after || (after instanceof Element && after.tagName === "BR"));
    replaceMath(element, tex, element.classList.contains("math-block") || source.startsWith("\\[") || source.startsWith("$$") || alone);
  });
  root.querySelectorAll('[data-tex], [data-latex]').forEach((element) => {
    if (!root.contains(element) || element.closest("pre,code")) return;
    replaceMath(element, element.getAttribute("data-tex") ?? element.getAttribute("data-latex")!,
      element.matches('.katex-display, [data-display="true"]') || Boolean(element.querySelector(".katex-display")));
  });
  root.querySelectorAll('pre').forEach((element) => {
    if (!root.contains(element)) return;
    const code = element.querySelector("code");
    if (code) replaceCode(element, code, element.getAttribute("data-language") ?? "");
  });
  root.querySelectorAll(".code-area").forEach((element) => {
    const code = element.querySelector("pre code");
    if (code) replaceCode(element, code);
  });
  root.querySelectorAll("button[data-copy-href]").forEach((element) => {
    const url = resolveAnswerUrl(element.getAttribute("data-copy-href")!, sourceUrl);
    const link = root.ownerDocument.createElement("a");
    if (url) link.href = url;
    link.append(...element.childNodes);
    element.replaceWith(link);
  });
  root.querySelectorAll("a[href]").forEach((link) => {
    const href = resolveAnswerUrl(link.getAttribute("href")!, sourceUrl);
    if (!href) return;
    const url = new URL(href);
    if (url.hostname === "link.wtturl.cn" && url.searchParams.has("target")) {
      link.setAttribute("href", resolveAnswerUrl(url.searchParams.get("target")!, sourceUrl));
    }
  });
  root.querySelectorAll('[data-copy-ignore="true"], [class*="mindmapExportCard"], [class*="table-header-"], [role="tablist"], [data-testid="message_action"], [data-testid="message_actions"], [data-testid="message_action_bar"], [data-testid*="copy"], [class*="code-block-header"], [class*="code-header"]').forEach((element) => element.remove());
  return serializeAnswer(root, sourceUrl);
}
