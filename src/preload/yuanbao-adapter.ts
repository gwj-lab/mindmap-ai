import { replaceCode, replaceMath, resolveAnswerUrl, serializeAnswer } from "./answer-markdown.js";

export const yuanbaoAdapter = {
  messageSelector: ".agent-chat__bubble--ai",
  content: (message: Element): Element => message.querySelector(".agent-chat__bubble__content") ?? message,
  toMarkdown: yuanbaoToMarkdown
};

export function yuanbaoToMarkdown(content: Element, sourceUrl: string): string {
  const root = content.cloneNode(true) as Element;
  root.querySelectorAll(".ybc-markdown-katex[data-latex]").forEach((element) => {
    replaceMath(element, element.getAttribute("data-latex")!, element.classList.contains("ybc-markdown-katex--display"));
  });
  // Replace the outer pane, including its toolbar and duplicate Mermaid preview.
  root.querySelectorAll("pre.ybc-pre-component").forEach((element) => {
    const code = element.querySelector("code[class*='language-']");
    if (code) replaceCode(element, code);
  });
  root.querySelectorAll("ol.ybc-ol-component").forEach((list) => {
    const start = list.querySelector(".ybc-li-component_dot")?.textContent?.trim().match(/^(\d+)\./)?.[1];
    if (start) list.setAttribute("start", start);
  });
  root.querySelectorAll("ul > ul, ul > ol, ol > ul, ol > ol").forEach((list) => {
    if (list.previousElementSibling?.tagName === "LI") list.previousElementSibling.append(list);
  });
  root.querySelectorAll(".ybc-li-component__dot-wp,.agent-chat__toolbar,.hyc-common-markdown__code__hd,.hyc-card-box-process-list").forEach((element) => element.remove());
  root.querySelectorAll("div.ybc-p").forEach((element) => {
    const paragraph = root.ownerDocument.createElement("p");
    paragraph.append(...element.childNodes);
    element.replaceWith(paragraph);
  });
  root.querySelectorAll(".hyc-common-markdown__link").forEach((element) => {
    if (!root.contains(element) || element.closest("a")) return;
    const label = element.querySelector(".hyc-common-markdown__link__content");
    const url = resolveAnswerUrl(element.getAttribute("data-href") || element.getAttribute("data-url") || label?.textContent?.trim() || "", sourceUrl);
    // A label alone is not a URL; never invent a source for a citation.
    if (!url || !/^(https:\/\/|mailto:)/.test(element.getAttribute("data-href") || element.getAttribute("data-url") || label?.textContent?.trim() || "")) return;
    const link = root.ownerDocument.createElement("a");
    link.href = url;
    link.textContent = label?.textContent ?? url;
    element.replaceWith(link);
  });
  return serializeAnswer(root, sourceUrl);
}
