import { memo, useMemo } from "react";
import ReactMarkdown, { type Options } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { safeLink } from "../../../shared/content.js";
import type { ProviderId } from "../../../shared/types.js";

interface MarkdownPreviewProps {
  body: string;
  className?: string;
  provider?: ProviderId;
  onOpenNote?(answerId: string): void;
}

const REMARK_PLUGINS = [remarkGfm, remarkMath];
interface MarkdownNode { type: string; value?: string; children?: MarkdownNode[] }
function tableCellBreaks() {
  return (tree: unknown): void => {
    const visit = (node: MarkdownNode, inCell = false): void => {
      const cell = inCell || node.type === "tableCell";
      if (cell && node.type === "html" && /^<br\s*\/?\s*>$/i.test(node.value ?? "")) {
        node.type = "break";
        delete node.value;
      }
      node.children?.forEach((child) => visit(child, cell));
    };
    visit(tree as MarkdownNode);
  };
}
const PLATFORM_REMARK_PLUGINS = [...REMARK_PLUGINS, tableCellBreaks];
const REHYPE_PLUGINS = [[rehypeKatex, { trust: false, maxExpand: 1000, maxSize: 20 }]] as NonNullable<Options["rehypePlugins"]>;

const components = {
  a: ({ title, children, href }: { title?: string; children?: React.ReactNode; href?: string }) => <a href={href} title={title === "chatgpt-source" ? undefined : title} className={title === "chatgpt-source" ? "markdown-citation" : undefined}>{children}</a>,
  table: ({ children }: { children?: React.ReactNode }) => <div className="markdown-table-wrap"><table>{children}</table></div>,
  pre: ({ children }: { children?: React.ReactNode }) => {
    const code = Array.isArray(children) ? children[0] : children;
    const language = code && typeof code === "object" && "props" in code
      ? (code.props as { className?: string }).className?.match(/language-([\w+-]+)/)?.[1] : undefined;
    const label = language && ({ javascript: "JavaScript", python: "Python", text: "纯文本" } as Record<string, string>)[language];
    return <div className="markdown-code-block">{language && <div className="markdown-code-language">{label ?? language}</div>}<pre>{children}</pre></div>;
  }
};

// Convert TeX delimiters before CommonMark consumes their backslashes.
// Code examples and escaped backslashes must keep their original meaning.
function normalizeMathText(text: string): string {
  let result = "";
  for (let index = 0; index < text.length;) {
    if (text[index] === "`") {
      const marker = text.slice(index).match(/^`+/)![0];
      let end = text.indexOf(marker, index + marker.length);
      while (end !== -1 && (text[end - 1] === "`" || text[end + marker.length] === "`")) {
        end = text.indexOf(marker, end + marker.length);
      }
      if (end !== -1) {
        result += text.slice(index, end + marker.length);
        index = end + marker.length;
        continue;
      }
      result += marker;
      index += marker.length;
      continue;
    }
    if (text[index] === "\\") {
      const opening = text[index + 1];
      if (opening === "(" || opening === "[") {
        const closing = opening === "(" ? "\\)" : "\\]";
        const end = text.indexOf(closing, index + 2);
        if (end !== -1) {
          const tex = text.slice(index + 2, end);
          result += opening === "[" ? `\n\n$$\n${tex.trim()}\n$$\n\n` : `$${tex}$`;
          index = end + 2;
          continue;
        }
      }
      result += text.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (text.startsWith("$$", index)) {
      const indent = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
      const endOfLine = text.indexOf("\n", index);
      const line = text.slice(index, endOfLine === -1 ? text.length : endOfLine);
      const display = line.match(/^\$\$(.+)\$\$[ \t]*$/);
      if (/^ {0,3}$/.test(indent) && display) {
        result += `$$\n${display[1]}\n${indent}$$`;
        index += line.length;
        continue;
      }
    }
    result += text[index];
    index += 1;
  }
  return result;
}

function normalizeDisplayMath(markdown: string): string {
  let fence: { marker: string; length: number } | null = null;
  const normalized: string[] = [];
  let prose: string[] = [];
  const flush = (): void => {
    normalized.push(normalizeMathText(prose.join("\n")));
    prose = [];
  };
  for (const line of markdown.split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (fence) {
      normalized.push(line);
      if (marker && marker[1][0] === fence.marker && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
    } else if (marker) {
      flush();
      fence = { marker: marker[1][0], length: marker[1].length };
      normalized.push(line);
    } else {
      prose.push(line);
    }
  }
  flush();
  return normalized.join("\n");
}

export const MarkdownPreview = memo(function MarkdownPreview({
  body,
  className = "markdown-preview",
  provider = "chatgpt",
  onOpenNote
}: MarkdownPreviewProps): React.JSX.Element {
  const normalizedBody = useMemo(() => normalizeDisplayMath(body), [body]);
  const localId = (href: string): string | null => href.match(/^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.md$/)?.[1] ?? null;
  return (
    <article className={className} data-provider={provider}>
      <ReactMarkdown
        remarkPlugins={provider === "chatgpt" ? REMARK_PLUGINS : PLATFORM_REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
        urlTransform={(url) => onOpenNote && localId(url) ? url : safeLink(url)}
        components={onOpenNote ? { ...components, a: ({ href, children, title }) => localId(href ?? "") ? <a className="concept-doc-link" href={href} onClick={(event) => { event.preventDefault(); onOpenNote(localId(href!)!); }}>{children}</a> : <components.a href={href} title={title}>{children}</components.a> } : components}
      >
        {normalizedBody}
      </ReactMarkdown>
    </article>
  );
});
