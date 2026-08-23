// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { contentHash, extractTitle, htmlToMarkdown, safeLink } from "../../src/shared/content.js";

describe("captured answer content", () => {
  test("extracts the first heading before falling back to a bounded sentence", () => {
    expect(extractTitle("Intro text\n\n## The useful heading\nBody")).toBe("The useful heading");
    expect(extractTitle("A concise sentence. More details follow.")).toBe("A concise sentence");
    expect(extractTitle("x".repeat(80))).toHaveLength(48);
  });

  test("uses a stable SHA-256 digest for duplicate detection", async () => {
    await expect(contentHash("same answer")).resolves.toBe(
      "01923cdf4c2c66c37742caf162c7b47a5021ad03665ddc831a09cc27ca8c2eee"
    );
  });

  test("preserves GFM tables, fenced code, and TeX math", () => {
    const root = document.createElement("article");
    root.innerHTML = `
      <h2>Result</h2>
      <p>Use <span class="katex" data-tex="x^2">rendered</span> inline.</p>
      <div class="katex-display" data-tex="\\int_0^1 x dx">rendered</div>
      <pre><code class="language-ts">const x = 1;</code></pre>
      <table><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>
    `;

    const markdown = htmlToMarkdown(root);
    expect(markdown).toContain("## Result");
    expect(markdown).toContain("$x^2$");
    expect(markdown).toContain("$$\\int_0^1 x dx$$");
    expect(markdown).toContain("```ts\nconst x = 1;\n```");
    expect(markdown).toContain("| A | B |");
  });

  test("allows only safe links in rendered Markdown", () => {
    expect(safeLink("https://example.com/a.png")).toBe("https://example.com/a.png");
    expect(safeLink("javascript:alert(1)")).toBe("");
    expect(safeLink("file:///C:/secret.txt")).toBe("");
  });
});
