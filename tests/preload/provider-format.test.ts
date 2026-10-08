// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import katex from "katex";
import { htmlToMarkdown } from "../../src/shared/content.js";
import { extractAnswerFromTarget, extractLatestAnswer, extractSelectedAnswer, findAssistantMessage } from "../../src/preload/answer-adapter.js";
import { yuanbaoToMarkdown } from "../../src/preload/yuanbao-adapter.js";
import { doubaoToMarkdown } from "../../src/preload/doubao-adapter.js";

const fixture = (provider: string, name: string) => readFileSync(path.resolve("tests/fixtures", provider, name), "utf8");
beforeEach(() => { document.body.innerHTML = ""; });

describe("independent platform answer formats", () => {
  test("keeps the previously verified real ChatGPT answer unchanged", async () => {
    const content = document.createElement("article");
    content.innerHTML = fixture("chatgpt", "format-answer.html");
    const expected = fixture("chatgpt", "format-answer.md").replace(/\r\n/g, "\n").trim();
    expect(htmlToMarkdown(content)).toBe(expected);
    expect((await extractSelectedAnswer(content, "https://chatgpt.com/c/format")).markdown).toBe(expected);
    const foreign = document.createElement("article");
    foreign.innerHTML = '<span class="ybc-markdown-katex" data-latex="a/b">visible</span>';
    yuanbaoToMarkdown(foreign, "https://yuanbao.tencent.com/");
    doubaoToMarkdown(foreign, "https://www.doubao.com/chat/");
    expect(htmlToMarkdown(content)).toBe(expected);
    expect(foreign.innerHTML).toContain('data-latex="a/b"');
  });

  test("recovers every original TeX and code block from the real Yuanbao answer", async () => {
    document.body.innerHTML = fixture("yuanbao", "format-answer.html");
    const original = document.body.innerHTML;
    const answer = await extractLatestAnswer(document, "https://yuanbao.tencent.com/chat/format");
    expect(answer?.provider).toBe("yuanbao");
    for (const element of document.querySelectorAll("[data-latex]")) {
      const tex = element.getAttribute("data-latex")!.trim();
      expect(answer?.markdown).toContain(element.classList.contains("ybc-markdown-katex--display") ? `$$\n${tex}\n$$` : `$${tex}$`);
    }
    for (const code of document.querySelectorAll("pre pre code")) {
      expect(answer?.markdown).toContain(code.textContent!.replace(/\n$/, ""));
      expect(answer?.markdown).toContain(code.className.match(/language-([\w+-]+)/)![1]);
    }
    expect(answer?.markdown).toContain("3.  第三步");
    expect(answer?.markdown).toContain("[x] 完成标题测试");
    expect(answer?.markdown).toContain("[ ] 完成表格测试");
    expect(answer?.markdown).toContain("| --- | :---: | ---: | --- |");
    expect(answer?.markdown).toContain("竖线 \\| 测试");
    expect(answer?.markdown).toContain("第一行内容<br>第二行内容");
    expect(answer?.markdown).toContain("[https://katex.org/docs/supported](https://katex.org/docs/supported)");
    expect(answer?.markdown).toContain("价格 \\$100 和 \\$9.99");
    expect(answer?.markdown).not.toContain("•");
    expect(answer?.markdown).not.toContain("复制图片");
    expect(answer?.markdown).not.toContain("svgGraph");
    expect(document.body.innerHTML).toBe(original);
    expect((await extractAnswerFromTarget(document.querySelector("h2"), answer!.sourceUrl))?.markdown).toBe(answer!.markdown);
  });

  test("recovers Doubao's copy-text math, resource links, code panes and empty-div breaks", async () => {
    document.body.innerHTML = fixture("doubao", "format-answer.html");
    const original = document.body.innerHTML;
    const result = await extractLatestAnswer(document, "https://www.doubao.com/chat/format");
    expect(result?.provider).toBe("doubao");
    expect(result?.sourceMessageId).toBe("57905928804975106");
    for (const element of document.querySelectorAll(".math-inline[copy-text]")) {
      const tex = element.getAttribute("copy-text")!.slice(2,-2).trim();
      expect(result?.markdown).toContain(tex);
    }
    for (const code of document.querySelectorAll("pre code")) expect(result?.markdown).toContain(code.textContent!.replace(/\n$/, ""));
    expect(result?.markdown).toContain("[https://katex.org/docs/supported](https://katex.org/docs/supported)");
    expect(result?.markdown).toContain("https://www.python.org/static/community_logos/python-logo.png");
    expect(result?.markdown).toContain("单行<br>单元格两行");
    expect(result?.markdown).not.toContain("运行");
    expect(result?.markdown).not.toContain("你的 AI 助手");
    expect(result?.markdown).not.toContain("link.wtturl.cn");
    expect(result?.markdown).not.toContain("data:image");
    expect(document.body.innerHTML).toBe(original);
  });

  for (const [provider, convert] of [["yuanbao", yuanbaoToMarkdown], ["doubao", doubaoToMarkdown]] as const) {
    test(`${provider}: headings, nested lists, tasks, quotes, links, images, footnotes and special characters`, () => {
      const root = document.createElement("article");
      root.innerHTML = '<h1>Title</h1><h2>Two</h2><h3>Three</h3><h4>Four</h4><h5>Five</h5><h6>Six</h6>'
        + '<p>中文 English <strong>bold</strong> <em>italic</em> <em><strong>both</strong></em> <del>deleted</del> <code>literal `tick` $100</code><br>new line</p>'
        + '<ol start="3"><li>Third<ul><li>Nested</li></ul></li><li>Fourth</li></ol>'
        + '<ul><li><input type="checkbox" checked>Done</li><li><input type="checkbox">Pending</li></ul>'
        + '<blockquote><p>Quote</p><blockquote>Nested quote</blockquote></blockquote><hr>'
        + '<p><a href="/reference">relative link</a> <a href="javascript:alert(1)">unsafe link</a> <a href="https://example.com"><img src="https://example.com/image.png" alt="图片"></a></p>'
        + '<p>Footnote<sup><a href="#fn-note" data-footnote-ref>1</a></sup></p><section data-footnotes><ol><li id="fn-note"><p>Footnote body<a data-footnote-backref href="#ref-note">↩</a></p></li></ol></section>'
        + '<p>Price $100 and $9.99; &amp; &lt; &gt; | * _</p><script>alert(1)</script><button>Copy</button>';
      const url = provider === "yuanbao" ? "https://yuanbao.tencent.com/chat/fixture" : "https://www.doubao.com/chat/fixture";
      const markdown = convert(root, url);
      for (const [level, text] of [[1,"Title"],[2,"Two"],[3,"Three"],[4,"Four"],[5,"Five"],[6,"Six"]] as const) expect(markdown).toContain(`${"#".repeat(level)} ${text}`);
      expect(markdown).toContain("**bold**");
      expect(markdown).toContain("_italic_");
      expect(markdown).toContain("~~deleted~~");
      expect(markdown).toContain("``literal `tick` $100``");
      expect(markdown).toContain("3.  Third");
      expect(markdown).toContain("[x] Done");
      expect(markdown).toContain("[ ] Pending");
      expect(markdown).toContain("> > Nested quote");
      expect(markdown).toContain(`[relative link](${new URL("/reference", url).href})`);
      expect(markdown).toContain("[![图片](https://example.com/image.png)](https://example.com/)");
      expect(markdown).toContain("[^note]");
      expect(markdown).toContain("[^note]: Footnote body");
      expect(markdown).toContain("Price \\$100 and \\$9.99");
      expect(markdown).not.toContain("javascript:");
      expect(markdown).not.toContain("alert(1)");
      expect(markdown).not.toContain("Copy");
    });

    test(`${provider}: 12 formulas, literal code, exact whitespace, table alignment and cell breaks`, () => {
      const root = document.createElement("article");
      const tex = [String.raw`\frac{a}{b}`,String.raw`x_i^2`,String.raw`\alpha+\beta`,String.raw`\sqrt{x}`,String.raw`\sum_{i=1}^n i`,String.raw`\frac{1}{1+\frac{1}{x}}`,String.raw`\int_0^1 x\,dx`,String.raw`B(a,b)=\frac{\Gamma(a)\Gamma(b)}{\Gamma(a+b)}`,String.raw`\binom{n}{m}`,String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,String.raw`f(x)=\begin{cases}x&x>0\\0&x\leq0\end{cases}`,String.raw`\begin{aligned}x+y&=1\\x-y&=0\end{aligned}`];
      root.innerHTML = tex.map((value,index)=>katex.renderToString(value,{displayMode:index>=5})).join(" ")
        + '<pre><code class="language-javascript"></code></pre><table><thead><tr><th style="text-align:left">Left</th><th style="text-align:center">Center</th><th style="text-align:right">Right</th></tr></thead><tbody><tr><td>pipe | char</td><td>one<br>two</td><td>123</td></tr></tbody></table>';
      const code = 'const literal = "$100 **bold** ```";\n\n\n  console.log(literal);\n';
      root.querySelector("pre code")!.textContent = code;
      const markdown = convert(root, "https://example.com/");
      tex.forEach((value,index)=>expect(markdown).toContain(index>=5 ? `$$\n${value}\n$$` : `$${value}$`));
      expect(markdown).toContain(`\`\`\`\`javascript\n${code}\`\`\`\``);
      expect(markdown).toContain("| :--- | :---: | ---: |");
      expect(markdown).toContain("pipe \\| char");
      expect(markdown).toContain("one<br>two");
    });
  }

  test("routes only assistant messages and refuses the latest streaming reply", async () => {
    for (const [provider,url] of [["doubao","https://www.doubao.com/chat/test"],["yuanbao","https://yuanbao.tencent.com/chat/test"]]) {
      const attributes = provider === "doubao" ? 'data-testid="receive_message"' : 'class="agent-chat__bubble--ai"';
      document.body.innerHTML = `<div id="user">Question</div><div ${attributes} id="old"><p>Old answer</p></div><div ${attributes} id="latest" data-is-streaming="true"><p>Partial answer</p></div>`;
      expect(findAssistantMessage(document.getElementById("user"),url)).toBeNull();
      expect(await extractLatestAnswer(document,url)).toBeNull();
      expect((await extractAnswerFromTarget(document.querySelector("#old p"),url))?.markdown).toBe("Old answer");
      document.getElementById("latest")!.removeAttribute("data-is-streaming");
      const selected = await extractLatestAnswer(document,url);
      expect(selected).toMatchObject({provider,sourceMessageId:"latest",markdown:"Partial answer"});
    }
  });

  test("Doubao keeps every answer text part and waits for streaming to finish", async () => {
    const url = "https://www.doubao.com/chat/test";
    document.body.innerHTML = '<div data-testid="receive_message"><div data-testid="message_content" data-message-id="parts"><div data-testid="message_text_content"><p>First part</p></div><div data-testid="message_text_content" data-streaming="true"><p>Second part</p></div></div><button>Suggested question</button></div>';
    expect(await extractLatestAnswer(document, url)).toBeNull();
    document.querySelector('[data-streaming]')!.setAttribute("data-streaming", "false");
    expect(await extractLatestAnswer(document, url)).toMatchObject({ sourceMessageId: "parts", markdown: "First part\n\nSecond part" });
  });
});
