import { describe, expect, test } from "vitest";
import { extractExpandedTitles, extractSingleTitle } from "../../src/shared/title-extraction.js";

describe("local title extraction", () => {
  test("prefers the first Markdown heading and removes inline markup", () => {
    expect(extractSingleTitle("Intro\n\n## **Portable** [mind map](https://example.com)\nBody")).toBe("Portable mind map");
  });

  test("uses the first meaningful Chinese sentence when no heading exists", () => {
    expect(extractSingleTitle("这里是核心结论。后面是解释！")).toBe("这里是核心结论");
  });

  test("ignores fenced code before prose", () => {
    expect(extractSingleTitle("```ts\nconst x = 1\n```\n\nUse a stable project folder. More detail."))
      .toBe("Use a stable project folder");
  });

  test("uses a meaningful table header for a table-first answer", () => {
    expect(extractSingleTitle("| Feature | Status |\n| --- | --- |\n| Export | Ready |"))
      .toBe("Feature · Status");
  });

  test("extracts stable, deduplicated headings and top-level list items", () => {
    const result = extractExpandedTitles(`
# Project plan
## Storage
## Storage
- Capture answers
  - nested detail
- Portable export
## Editing
`);
    expect(result).toEqual({
      title: "Project plan",
      subtitles: ["Storage", "Capture answers", "Portable export", "Editing"]
    });
  });

  test("caps expanded children at 12", () => {
    const markdown = ["# Root", ...Array.from({ length: 20 }, (_, index) => `- Child ${index + 1}`)].join("\n");
    expect(extractExpandedTitles(markdown).subtitles).toHaveLength(12);
    expect(extractExpandedTitles(markdown).subtitles.at(-1)).toBe("Child 12");
  });

  test("truncates by display width rather than UTF-16 length", () => {
    const title = extractSingleTitle("这是一个非常长的中文标题用于验证显示宽度截断不会超出四十八列并保持稳定");
    const width = [...title].reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) > 0xff ? 2 : 1), 0);
    expect(width).toBeLessThanOrEqual(48);
    expect(title.length).toBeLessThan(48);
  });

  test("returns a stable fallback for empty or markup-only content", () => {
    expect(extractSingleTitle(" \n<!-- empty -->\n```\n```" )).toBe("未命名回答");
    expect(extractExpandedTitles("")).toEqual({ title: "未命名回答", subtitles: [] });
  });
});
