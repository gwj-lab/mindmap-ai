const TITLE_DISPLAY_WIDTH = 48;
const MAX_SUBTITLES = 12;

function isWide(char: string): boolean {
  const point = char.codePointAt(0) ?? 0;
  return point >= 0x1100 && (
    point <= 0x115f
    || point === 0x2329
    || point === 0x232a
    || (point >= 0x2e80 && point <= 0xa4cf)
    || (point >= 0xac00 && point <= 0xd7a3)
    || (point >= 0xf900 && point <= 0xfaff)
    || (point >= 0xfe10 && point <= 0xfe6f)
    || (point >= 0xff00 && point <= 0xff60)
    || (point >= 0xffe0 && point <= 0xffe6)
    || (point >= 0x1f300 && point <= 0x1faff)
  );
}

function truncateDisplayWidth(value: string, limit = TITLE_DISPLAY_WIDTH): string {
  let width = 0;
  let output = "";
  for (const char of value) {
    const nextWidth = width + (isWide(char) ? 2 : 1);
    if (nextWidth > limit) break;
    output += char;
    width = nextWidth;
  }
  return output.trim();
}

function stripInlineMarkdown(value: string): string {
  return value
    .replace(/^\s*[#>]+\s*/g, "")
    .replace(/<!--[^]*?-->/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_~]/g, "")
    .replace(/\\([#>[\]()!.*_`~-])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function withoutFencedCode(markdown: string): string {
  return markdown.replace(/```[^\n]*\n[\s\S]*?```/g, "\n").replace(/~~~[^\n]*\n[\s\S]*?~~~/g, "\n");
}

function meaningfulSentences(value: string): string[] {
  return stripInlineMarkdown(value)
    .split(/[。！？.!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 1);
}

function tableTitle(markdown: string): string | null {
  const lines = markdown.split(/\r?\n/);
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index]?.trim() ?? "";
    const delimiter = lines[index + 1]?.trim() ?? "";
    if (!header.includes("|") || !/^\|?\s*:?-{3,}/.test(delimiter)) continue;
    const cells = header.replace(/^\||\|$/g, "").split("|").map(stripInlineMarkdown).filter(Boolean);
    if (cells.length > 0) return cells.join(" · ");
  }
  return null;
}

function normalizeTitle(value: string): string {
  return truncateDisplayWidth(stripInlineMarkdown(value)) || "未命名回答";
}

export function extractSingleTitle(markdown: string): string {
  const source = withoutFencedCode(markdown);
  const heading = source.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1];
  if (heading) return normalizeTitle(heading);

  const table = tableTitle(source);
  if (table) return normalizeTitle(table);

  const prose = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[-|:]+$/.test(line) && !/^\|/.test(line))
    .join(" ");
  const sentence = meaningfulSentences(prose)[0];
  return sentence ? normalizeTitle(sentence) : "未命名回答";
}

export function extractExpandedTitles(markdown: string): { title: string; subtitles: string[] } {
  const source = withoutFencedCode(markdown);
  const title = extractSingleTitle(source);
  const candidates: string[] = [];

  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/)?.[1];
    const listItem = line.match(/^(?:[-+*]|\d+[.)])\s+(.+)$/)?.[1];
    if (heading) candidates.push(heading);
    else if (listItem) candidates.push(listItem.replace(/^\[[ xX]\]\s*/, ""));
  }

  if (candidates.length <= 1) {
    const paragraphs = source.split(/\n\s*\n/).flatMap(meaningfulSentences);
    candidates.push(...paragraphs);
  }

  const seen = new Set([title.toLocaleLowerCase()]);
  const subtitles: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeTitle(candidate);
    const key = normalized.toLocaleLowerCase();
    if (normalized === "未命名回答" || seen.has(key)) continue;
    seen.add(key);
    subtitles.push(normalized);
    if (subtitles.length === MAX_SUBTITLES) break;
  }
  return { title, subtitles };
}
