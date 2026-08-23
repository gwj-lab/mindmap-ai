// @vitest-environment jsdom
import { render } from "@testing-library/react";
import React from "react";
import { describe, expect, test } from "vitest";
import { MarkdownPreview } from "../../src/renderer/src/components/MarkdownPreview.js";

describe("MarkdownPreview", () => {
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
