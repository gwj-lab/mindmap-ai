import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

for (const provider of ["chatgpt", "yuanbao", "doubao"] as const) {
  test(`${provider}: captures platform DOM, saves the note, and faithfully renders formats`, async () => {
    test.setTimeout(90_000);
    const projectDir = await mkdtemp(path.join(tmpdir(), "mindmap-format-workspace-"));
    const userData = await mkdtemp(path.join(tmpdir(), "mindmap-format-profile-"));
    const application = await electron.launch({ args: [".", `--user-data-dir=${userData}`] });
    try {
      await application.evaluate(({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
      }, projectDir);
      const page = await application.firstWindow();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.getByRole("button", { name: "新建工作区", exact: true }).first().click();
      if (provider !== "chatgpt") await page.getByRole("combobox", { name: "新建问答标签页" }).selectOption(provider);
      const html = await readFile(path.resolve("tests/fixtures", provider, "format-answer.html"), "utf8");
      const sourceUrl = {
        chatgpt: "https://chatgpt.com/c/format-fixture", yuanbao: "https://yuanbao.tencent.com/chat/format-fixture", doubao: "https://www.doubao.com/chat/format-fixture"
      }[provider];
      await application.evaluate(async ({ session, webContents }, fixture) => {
        const isolated = session.fromPartition(`persist:provider-${fixture.provider}`);
        // Replay captured DOM at the real origin, using the production sandboxed
        // preload and IPC. No website request or account is needed in this test.
        await isolated.protocol.handle("https", () => new Response("<!doctype html><html><head><meta charset=utf-8></head><body>" + fixture.html + "</body></html>", { headers: { "Content-Type": "text/html; charset=utf-8" } }));
        const contents = webContents.getAllWebContents().find((entry) => entry.session === isolated)!;
        await contents.loadURL(fixture.sourceUrl);
      }, { provider, sourceUrl, html: provider === "chatgpt" ? `<article data-message-author-role="assistant" data-message-id="chatgpt-format-test">${html}</article>` : html });
      await expect.poll(() => application.evaluate(async ({ session, webContents }, selectedProvider) => {
        const contents = webContents.getAllWebContents().find((entry) => entry.session === session.fromPartition(`persist:provider-${selectedProvider}`))!;
        return contents.executeJavaScript("Boolean(document.getElementById('mindmap-ai-hover-style'))") as Promise<boolean>;
      }, provider)).toBe(true);
      await page.getByRole("button", { name: "捕获最新回答" }).click();
      const candidate = page.locator(".node-tray-card");
      await expect(candidate).toHaveCount(1);
      const workspace = JSON.parse(await readFile(path.join(projectDir, "workspace.json"), "utf8")) as { activeProjectId: string };
      const projectPath = path.join(projectDir, "projects", workspace.activeProjectId);
      const project = JSON.parse(await readFile(path.join(projectPath, "project.json"), "utf8")) as { state: { candidates: Array<{ answerId: string; title: string }> } };
      const captured = project.state.candidates[0];
      const saved = await readFile(path.join(projectDir, "answers", `${captured.answerId}.md`), "utf8");
      expect(saved).toContain(`provider: ${provider}`);
      const answer = await page.evaluate((id) => window.mindmapAI.project.readAnswer(id), captured.answerId);
      expect(answer?.body).toBeTruthy();
      expect(saved).toContain(answer!.body);
      if (provider === "chatgpt") {
        const previous = await readFile(path.resolve("tests/fixtures/chatgpt/format-answer.md"), "utf8");
        expect(answer!.body).toBe(previous.replace(/\r\n/g, "\n").trim());
      }
      await writeFile(`test-results/${provider}-saved-note.md`, saved);
      await candidate.dragTo(page.locator(".mindmap-canvas .smm-node").first());
      const answerNode = page.locator(".mindmap-canvas .smm-node", { hasText: captured.title }).first();
      await answerNode.dblclick();
      const reader = page.getByLabel("回答阅读器");
      await expect(reader).toBeVisible();
      const preview = reader.locator(".markdown-preview");
      await expect(preview.locator(".katex")).toHaveCount(provider === "chatgpt" ? 12 : 13);
      await expect(preview.locator(".katex-display")).toHaveCount(7);
      await expect(preview.locator(".katex-error")).toHaveCount(0);
      await expect(preview.locator("pre code")).toHaveCount(provider === "chatgpt" ? 3 : 4);
      if (provider !== "chatgpt") await expect(preview.locator("td br")).toHaveCount(1);
      const sourceCode = await application.evaluate(async ({ session, webContents }, selectedProvider) => {
        const contents = webContents.getAllWebContents().find((entry) => entry.session === session.fromPartition(`persist:provider-${selectedProvider}`))!;
        return contents.executeJavaScript(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(selectedProvider === "chatgpt" ? '[data-markdown-copy="code-block"] code' : "pre code")})].map(e=>e.textContent))`) as Promise<string>;
      }, provider);
      const renderedCode = await preview.locator("pre code").allTextContents();
      expect(renderedCode.map((code) => code.replace(/\n$/, ""))).toEqual((JSON.parse(sourceCode) as string[]).map((code) => code.replace(/\n$/, "")));
      const report = await preview.evaluate(async (element) => {
        await document.fonts.ready;
        return {
          headings: [...element.querySelectorAll("h1,h2,h3,h4,h5,h6")].map((heading) => heading.textContent),
          codeBlocks: element.querySelectorAll("pre code").length,
          formulas: element.querySelectorAll(".katex").length,
          displayFormulas: element.querySelectorAll(".katex-display").length,
          mathErrors: element.querySelectorAll(".katex-error").length,
          tableAlign: [...element.querySelectorAll("th")].map((cell) => getComputedStyle(cell).textAlign),
          tableBreaks: element.querySelectorAll("td br").length,
          images: [...element.querySelectorAll("img")].map((image) => ({ alt: image.alt, src: image.getAttribute("src"), maxWidth: getComputedStyle(image).maxWidth })),
          tasks: [...element.querySelectorAll('input[type="checkbox"]')].map((checkbox) => (checkbox as HTMLInputElement).checked),
          mathClipping: [...element.querySelectorAll(".katex-display")].map((block) => {
            const outer = block.getBoundingClientRect();
            const glyphs = [...block.querySelectorAll(".katex-html .mord, .katex-html .mop, .katex-html .frac-line")].filter((glyph) => glyph.childElementCount === 0).map((glyph) => glyph.getBoundingClientRect());
            return { top: Math.max(0, outer.top - Math.min(...glyphs.map((glyph) => glyph.top))), bottom: Math.max(0, Math.max(...glyphs.map((glyph) => glyph.bottom)) - outer.bottom) };
          })
        };
      });
      for (const block of report.mathClipping) { expect(block.top).toBeLessThanOrEqual(1); expect(block.bottom).toBeLessThanOrEqual(1); }
      expect(report.tasks).toContain(true);
      expect(report.tasks).toContain(false);
      if (provider !== "chatgpt") expect(report.tableAlign).toEqual(["left", "center", "right", "left"]);
      if (provider === "doubao") expect(report.images[0]).toMatchObject({ src: "https://www.python.org/static/community_logos/python-logo.png", maxWidth: "100%" });
      expect(errors).toEqual([]);
      await writeFile(`test-results/${provider}-format-report.json`, JSON.stringify({ provider, sample: "real webpage DOM replay", ...report }, null, 2));
      await reader.screenshot({ path: `test-results/${provider}-reader-format.png` });
      await preview.locator("table").first().scrollIntoViewIfNeeded();
      await reader.screenshot({ path: `test-results/${provider}-reader-table.png` });
      await preview.locator(".katex-display").nth(4).scrollIntoViewIfNeeded();
      await reader.screenshot({ path: `test-results/${provider}-reader-math.png` });
      expect(await readdir(path.join(projectDir, "answers"))).toHaveLength(1);
    } finally {
      await application.close();
      await rm(projectDir, { recursive: true, force: true });
      await rm(userData, { recursive: true, force: true });
    }
  });
}
