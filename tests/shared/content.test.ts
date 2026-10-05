// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import katex from "katex";
import { contentHash, extractTitle, htmlToMarkdown, safeLink } from "../../src/shared/content.js";

describe("captured answer content", () => {
  test("recovers lazy TeX placeholders without escaping formulas or changing code", () => {
    const root = document.createElement("article");
    root.innerHTML = String.raw`<p>Inline \(x_i^2\).</p><p>\[\int_0^1 \frac{x}{2}\,dx\]</p><pre><code>\(literal\)</code></pre>`;
    const markdown = htmlToMarkdown(root);
    expect(markdown).toContain("$x_i^2$");
    expect(markdown).toContain(String.raw`$$\int_0^1 \frac{x}{2}\,dx$$`);
    expect(markdown).toContain("```\n\\(literal\\)\n```");
  });
  test("captures current ChatGPT copy markers, image buttons and exact code whitespace", () => {
    const root = document.createElement("article");
    const code = 'const price = "$9.99";\n\n\nconsole.log("```", price);';
    root.innerHTML = `<p>Use <span data-markdown-copy="inline-code">const price = "$9.99";</span></p>
      <div data-markdown-copy="code-block"><div data-markdown-copy="exclude"><div class="truncate">JavaScript</div><button>Copy</button></div>
      <div><code></code></div></div>
      <p><button data-message-image="original"><img alt="Python 标志" src="https://www.python.org/logo.png"></button></p>
      <table><thead><tr><th align="center">Center</th><th align="right">Right</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>`;
    root.querySelector("code")!.textContent = code;
    const markdown = htmlToMarkdown(root);
    expect(markdown).toContain('`const price = "$9.99";`');
    expect(markdown).toContain(`\`\`\`\`javascript\n${code}\n\`\`\`\``);
    expect(markdown).toContain("![Python 标志](https://www.python.org/logo.png)");
    expect(markdown).toContain("| :-: | --: |");
    expect(markdown).not.toContain("Copy");
  });
  test("preserves ChatGPT task buttons and source citations", () => {
    const root = document.createElement("article");
    root.innerHTML = `<ul><li><div data-markdown-copy="contents"><button role="checkbox" aria-checked="true"></button></div>Done</li>
      <li><div data-markdown-copy="contents"><button role="checkbox" aria-checked="false"></button></div>Pending</li></ul>
      <p>Source <a data-testid="chatgpt-citation" href="https://katex.org/docs/supported"><span>KaTeX</span><svg><path /></svg></a></p>`;
    expect(htmlToMarkdown(root)).toContain("[x] Done");
    expect(htmlToMarkdown(root)).toContain("[ ] Pending");
    expect(htmlToMarkdown(root)).toContain('[KaTeX](https://katex.org/docs/supported "chatgpt-source")');
  });
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

  test("recovers original TeX from real KaTeX MathML without duplicated visual text", () => {
    const inline = String.raw`\frac{a}{b}`;
    const display = String.raw`\int_0^1 \frac{x^2}{1+x}\,dx`;
    const root = document.createElement("article");
    root.innerHTML = `<p>Inline ${katex.renderToString(inline)}</p>${katex.renderToString(display, { displayMode: true })}`;
    expect(htmlToMarkdown(root)).toBe(`Inline $${inline}$\n\n$$${display}$$`);
  });
});
