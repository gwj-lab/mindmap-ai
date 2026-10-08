// @vitest-environment jsdom
import { render } from "@testing-library/react";
import React from "react";
import { createRequire } from "node:module";
import { describe, expect, test } from "vitest";
import { MarkdownPreview } from "../../src/renderer/src/components/MarkdownPreview.js";

describe("MarkdownPreview", () => {
  test("renders new-platform table breaks safely while keeping ChatGPT rendering unchanged", () => {
    const body = "| A | B |\n| --- | --- |\n| one<br>two | <img src=x onerror=alert(1)>unsafe |";
    const chatgpt = render(<MarkdownPreview body={body} />);
    expect(chatgpt.container.querySelector("td br")).toBeNull();
    for (const provider of ["doubao", "yuanbao"] as const) {
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
