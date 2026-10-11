// @vitest-environment jsdom
import { render } from "@testing-library/react";
import React from "react";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { MarkdownPreview } from "../../src/renderer/src/components/MarkdownPreview.js";
import { readFileSync } from 'node:fs';
import { kimiToMarkdown } from '../../src/preload/kimi-adapter.js';

describe("MarkdownPreview", () => {
  test('keeps footnote references and return anchors with concept-note links enabled', () => {
    const { container } = render(<MarkdownPreview body={'Footnote [^note].\n\n[^note]: Body.'} onOpenNote={() => {}} />);
    expect(container.querySelector('[data-footnote-ref]')?.getAttribute('href')).toBe('#user-content-fn-note');
    expect(container.querySelector('[data-footnote-ref]')?.id).toBe('user-content-fnref-note');
    expect(container.querySelector('[data-footnote-backref]')?.getAttribute('href')).toBe('#user-content-fnref-note');
  });
  test('renders every real Kimi fallback equation as an inert formula frame', () => {
    const source = document.createElement('div');
    source.innerHTML = readFileSync('tests/fixtures/kimi/format-answer.html', 'utf8');
    const { container } = render(<MarkdownPreview body={kimiToMarkdown(source, 'https://www.kimi.com/')} provider="kimi" />);
    const frames = [...container.querySelectorAll('iframe')];
    expect(frames).toHaveLength(14);
    expect(frames.every((frame) => frame.getAttribute('sandbox') === '')).toBe(true);
    expect(frames.at(-1)?.srcdoc).toContain('katex-html');
    expect(container.querySelector('.katex')).toBeNull();
  });
  test('does not interpret escaped footnote markers as TeX', () => {
    const { container } = render(<MarkdownPreview body={String.raw`Footnote \[^note\].

\[^note\]: Body.`} provider="deepseek" />);
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toContain('[^note]');
  });
  test("renders table cell breaks safely on all providers", () => {
    const body = "| A | B |\n| --- | --- |\n| one<br>two | <img src=x onerror=alert(1)>unsafe |";
    const chatgpt = render(<MarkdownPreview body={body} />);
    expect(chatgpt.container.querySelectorAll("td br")).toHaveLength(1);
    for (const provider of ["doubao", "yuanbao", "deepseek", "kimi"] as const) {
      const result = render(<MarkdownPreview body={body} provider={provider} />);
      expect(result.container.querySelectorAll("td br")).toHaveLength(1);
      expect(result.container.querySelector("img")).toBeNull();
      expect(result.container.querySelector("td")?.textContent).toBe("one\ntwo");
    }
  });
  test("uses the same KaTeX engine as the installed stylesheet and fonts", () => {
    const require = createRequire(import.meta.url);
    const pluginRequire = createRequire(require.resolve("rehype-katex"));
    expect(pluginRequire("katex").version).toBe(require("katex").version);
  });

  test("renders ChatGPT delimiters, fractions, integrals and matrices", () => {
    const { container } = render(<MarkdownPreview body={String.raw`Inline \(\frac{1}{2}\).

\[
\int_0^1 \frac{x^2}{1+x}\,dx
\]

$$\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}$$`} />);
    expect(container.querySelectorAll(".katex")).toHaveLength(3);
    expect(container.querySelectorAll(".katex-display")).toHaveLength(2);
    expect(container.querySelector(".katex-error")).toBeNull();
    expect(container.querySelectorAll(".mfrac").length).toBeGreaterThanOrEqual(2);
    expect(container.querySelector(".mtable")).not.toBeNull();
  });

  test("leaves formula examples in code and escaped delimiters untouched", () => {
    const { container } = render(<MarkdownPreview body={String.raw`Use \(x\) but keep \`\(y\)\` as code.

~~~~text
\[\frac{1}{2}\]
$$x$$
~~~
\(z\)
~~~~

Escaped \\(literal\\).`.replaceAll("\\`", "`")} />);
    expect(container.querySelectorAll(".katex")).toHaveLength(1);
    expect(container.querySelector("pre code")?.textContent).toContain(String.raw`\(z\)`);
    expect(container.querySelector("p code")?.textContent).toBe(String.raw`\(y\)`);
  });
  test("renders inline and display TeX through KaTeX", () => {
    const { container } = render(
      <MarkdownPreview body={"Inline $x^2$\n\n$$y = mx + b$$"} />
    );

    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  test("keeps citation icons inside links and ordinary images independent", () => {
    const { container } = render(
      <MarkdownPreview
        body={"[![source](https://example.com/icon.svg) Source](https://example.com/report)\n\n![Chart](https://example.com/chart.png)"}
      />
    );

    expect(container.querySelector("a > img")?.getAttribute("src")).toBe(
      "https://example.com/icon.svg"
    );
    expect(container.querySelector("p > img")?.getAttribute("src")).toBe(
      "https://example.com/chart.png"
    );
  });
});
