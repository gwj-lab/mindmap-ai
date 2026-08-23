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
  clone.querySelectorAll("script,style,button,[data-testid*='copy'],[aria-label*='Copy'],[aria-label*='复制']")
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

  const turndown = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "_",
    strongDelimiter: "**"
  });
  turndown.use(gfm);
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
      return `\n\n\`\`\`${language}\n${code.textContent?.replace(/\n$/, "") ?? ""}\n\`\`\`\n\n`;
    }
  });
  return turndown.turndown(clone.innerHTML).replace(/\n{3,}/g, "\n\n").trim();
}

export function safeLink(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "mailto:" ? parsed.href : "";
  } catch {
    return "";
  }
}
