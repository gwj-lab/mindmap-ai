import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { safeLink } from "../../../shared/content.js";

interface MarkdownPreviewProps {
  body: string;
  className?: string;
}

function normalizeDisplayMath(markdown: string): string {
  let fence: "```" | "~~~" | null = null;
  const normalized: string[] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    const fenceMarker = trimmed.startsWith("```")
      ? "```"
      : trimmed.startsWith("~~~")
        ? "~~~"
        : null;
    if (fenceMarker) {
      fence = fence === fenceMarker ? null : fence ?? fenceMarker;
      normalized.push(line);
      continue;
    }
    if (!fence && trimmed.startsWith("$$") && trimmed.endsWith("$$") && trimmed.length > 4) {
      normalized.push("$$", trimmed.slice(2, -2), "$$");
    } else {
      normalized.push(line);
    }
  }
  return normalized.join("\n");
}

export function MarkdownPreview({
  body,
  className = "markdown-preview"
}: MarkdownPreviewProps): React.JSX.Element {
  return (
    <article className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        urlTransform={safeLink}
      >
        {normalizeDisplayMath(body)}
      </ReactMarkdown>
    </article>
  );
}
