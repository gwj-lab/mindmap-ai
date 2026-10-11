import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm, mkdir, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ProviderId } from "../../src/shared/types.js";

function fixture(provider: Extract<ProviderId, "chatgpt" | "yuanbao" | "doubao">): string {
  const editor = { chatgpt: '<textarea id="prompt-textarea"></textarea><button data-testid="send-button">发送</button>', yuanbao: '<div class="ql-editor" contenteditable="true"></div><div id="yuanbao-send-btn" role="button">发送</div>', doubao: '<div class="tiptap ProseMirror" contenteditable="true"></div><button data-testid="chat_input_send_button">发送</button>' }[provider];
  const message = (id: string, body: string, streaming = false): string => provider === "chatgpt" ? `<article data-message-author-role="assistant" data-message-id="${id}"${streaming ? ' data-is-streaming="true"' : ""}><div class="markdown">${body}</div></article>` : provider === "yuanbao" ? `<div class="agent-chat__bubble--ai" data-message-id="${id}"${streaming ? ' data-is-streaming="true"' : ""}><div class="agent-chat__bubble__content">${body}</div></div>` : `<div data-testid="receive_message"><div data-testid="message_content" data-message-id="${id}"><div data-testid="message_text_content" data-streaming="${streaming}">${body}</div></div></div>`;
  return `<!doctype html><html><meta charset="utf-8"><body>${editor}${message("source", "<h1>回归模型</h1><p>第一句话。残差是观测值与预测值之差。</p>")}<script>
  document.querySelector('button,[role=button]').addEventListener('click',()=>{
    const input = document.querySelector('textarea,[contenteditable]'); document.body.dataset.sentPrompt=input.value ?? input.textContent;
    const wrapper=document.createElement('section');wrapper.innerHTML=${JSON.stringify(message("generated", "<h1>残差</h1><p>概念解释：这是观测值与预测值之差。</p>", true))};document.body.append(wrapper);
    setTimeout(()=>{wrapper.querySelector('[data-is-streaming]')?.removeAttribute('data-is-streaming');wrapper.querySelector('[data-streaming]')?.setAttribute('data-streaming','false')},1200);
  });</script></body></html>`;
}

for (const provider of ["chatgpt", "yuanbao", "doubao"] as const) test(`${provider}: concept selection, background generation, links, node tags and persistence`, async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(path.join(tmpdir(), "mindmap-concepts-workspace-"));
  const profile = await mkdtemp(path.join(tmpdir(), "mindmap-concepts-profile-"));
  let application = await electron.launch({ args: [".", `--user-data-dir=${profile}`] });
  try {
    await application.evaluate(({ dialog }, root) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] }); }, root);
    let page = await application.firstWindow();
    await page.getByRole("button", { name: "新建工作区", exact: true }).first().click();
    if (provider !== "chatgpt") await page.getByRole("combobox", { name: "新建问答标签页" }).selectOption(provider);
    await application.evaluate(async ({ session, webContents }, fixture) => {
      const isolated = session.fromPartition(`persist:provider-${fixture.provider}`);
      await isolated.protocol.handle("https", () => new Response(fixture.html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
      const contents = webContents.getAllWebContents().find((contents) => contents.session === isolated)!;
      if (contents.isLoading()) await new Promise<void>((resolve) => { contents.once("did-stop-loading", resolve); contents.stop(); });
      await contents.loadURL(fixture.url);
    }, { provider, html: fixture(provider), url: { chatgpt: "https://chatgpt.com/c/source", yuanbao: "https://yuanbao.tencent.com/chat/source", doubao: "https://www.doubao.com/chat/source" }[provider] });
    await page.getByRole("button", { name: "捕获最新回答" }).click();
    const candidate = page.locator(".node-tray-card").first();
    await expect(candidate).toBeVisible();
    await expect(page.locator(".mindmap-canvas .smm-node").first()).toBeVisible();
    await candidate.dragTo(page.locator(".mindmap-canvas .smm-node").first());
    if (await candidate.isVisible()) await candidate.dragTo(page.locator(".mindmap-canvas .smm-node").first());
    await expect(page.locator(".mindmap-canvas .smm-node", { hasText: "回归模型" })).toBeVisible();
    await page.getByRole("button", { name: "概念生成设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "概念生成设置" });
    await settings.getByRole("checkbox").check();
    await settings.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(settings).not.toBeVisible();
    await page.locator(".mindmap-canvas .smm-node", { hasText: "回归模型" }).dblclick();
    let reader = page.getByLabel("回答阅读器");
    await expect(reader).toBeVisible();
    const selectWord = async (): Promise<void> => {
      await reader.locator(".markdown-preview p").first().evaluate((element) => {
        const node = element.firstChild!; const index = node.textContent!.indexOf("残差");
        const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 2);
        const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
      });
    };
    await selectWord();
    await expect(page.getByRole("button", { name: "生成概念：残差", exact: true })).toBeVisible();
    await page.screenshot({ path: `test-results/${provider}-concept-selection.png` });
    await reader.locator(".answer-heading strong").click();
    await expect(page.getByRole("button", { name: "生成概念：残差", exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.getSelection()!.rangeCount)).toBe(0);
    expect((await page.evaluate(() => window.mindmapAI.concepts.get())).records).toHaveLength(0);
    await selectWord();
    await page.getByRole("button", { name: "生成概念：残差", exact: true }).click();
    await expect(reader).toBeVisible(); // Background mode leaves the reading context in place.
    await expect.poll(async () => (await page.evaluate(() => window.mindmapAI.concepts.get())).records.length).toBe(1);
    const pending = (await page.evaluate(() => window.mindmapAI.concepts.get())).records[0]!;
    await expect(page.locator(`[id="flexlayout-tabbutton-${pending.tabId}"]`)).toHaveCount(0);
    await expect.poll(async () => application.evaluate(async ({ webContents }, origin) => {
      return Promise.all(webContents.getAllWebContents().filter((entry) => entry.getURL().startsWith(origin)).map((contents) => contents.executeJavaScript("document.body.dataset.sentPrompt") as Promise<string>));
    }, { chatgpt: "https://chatgpt.com/", yuanbao: "https://yuanbao.tencent.com/", doubao: "https://www.doubao.com/" }[provider]).then((sent) => sent.filter(Boolean)), { timeout: 15000 }).toEqual([pending.prompt]);
    if (provider === "chatgpt") {
      await page.locator(".concept-node-card").getByRole("button", { name: "查看生成页面", exact: true }).click();
      await expect(page.locator(`[id="flexlayout-tabbutton-${pending.tabId}"]`)).toBeVisible();
      await page.locator(".mindmap-canvas .smm-node", { hasText: "回归模型" }).dblclick();
      await expect(reader).toBeVisible();
    }
    await expect.poll(async () => (await page.evaluate(() => window.mindmapAI.concepts.get())).records[0]?.status, { timeout: 20000 }).toBe("ready");
    const library = await page.evaluate(() => window.mindmapAI.concepts.get());
    const record = library.records[0]!;
    await expect(page.locator(`[id="flexlayout-tabbutton-${record.tabId}"]`)).toHaveCount(0);
    expect(record.prompt).toContain("原文中的完整句子是：“残差是观测值与预测值之差。”");
    expect(record.prompt).toContain("当前主题是“回归模型”");
    await expect.poll(async () => application.evaluate(({ webContents }, origin) => webContents.getAllWebContents().filter((entry) => entry.getURL().startsWith(origin)).length, { chatgpt: "https://chatgpt.com/", yuanbao: "https://yuanbao.tencent.com/", doubao: "https://www.doubao.com/" }[provider])).toBe(1);
    await expect(page.getByRole("button", { name: "打开概念：残差", exact: true })).toBeVisible();
    // Mark and text must share coordinates immediately, before another frame/timer.
    const alignment = await reader.locator('.answer-pane:not([hidden]) .markdown-preview').evaluate((root) => {
      const chip = root.querySelector<HTMLButtonElement>('[aria-label="打开概念：残差"]')!;
      const text = root.querySelector('p')!.firstChild!;
      const index = text.textContent!.indexOf('残差');
      const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 2);
      const spacer = document.createElement('div'); spacer.style.height = '1200px'; root.append(spacer);
      const before = chip.getBoundingClientRect().top;
      root.scrollTop = 40;
      const after = chip.getBoundingClientRect().top;
      const error = Math.abs(after - range.getBoundingClientRect().top + 1);
      const native = CSS.highlights.size > 0;
      root.scrollTop = 0; spacer.remove();
      return { moved: before - after, error, native };
    });
    expect(alignment.moved).toBe(40); expect(alignment.error).toBeLessThan(2); expect(alignment.native).toBe(true);
    const heading = await reader.locator('.answer-pane:not([hidden]) .answer-heading').boundingBox();
    await page.mouse.move(heading!.x + 30, heading!.y + 10); await page.mouse.down();
    await page.mouse.move(heading!.x + 90, heading!.y + 35);
    const dragError = await reader.locator('.answer-pane:not([hidden]) .markdown-preview').evaluate((root) => {
      const text = root.querySelector('p')!.firstChild!; const index = text.textContent!.indexOf('残差');
      const range = document.createRange(); range.setStart(text, index); range.setEnd(text, index + 2);
      return Math.abs(root.querySelector('[aria-label="打开概念：残差"]')!.getBoundingClientRect().top - range.getBoundingClientRect().top + 1);
    });
    expect(dragError).toBeLessThan(2); await page.mouse.up();
    await page.getByRole("button", { name: "打开概念：残差", exact: true }).click();
    await expect(reader.locator(".concept-tab-preview .markdown-preview")).toContainText("概念解释：这是观测值与预测值之差。");
    await expect(reader.locator('.answer-pane:not([hidden]) .markdown-preview')).toContainText("第一句话。");
    await reader.locator('.concept-tab-preview .markdown-preview').dblclick({ position: { x: 12, y: 230 } });
    await expect(reader.getByRole('button', { name: '回退到节点页面', exact: true })).toBeVisible();
    await expect(reader.locator('.answer-pane:not([hidden]) .markdown-preview')).toContainText("概念解释：这是观测值与预测值之差。");
    await expect(reader.locator(".concept-backlinks")).toContainText("残差是观测值与预测值之差。");
    await page.screenshot({ path: `test-results/${provider}-concept-full-reader.png` });
    await reader.getByRole('button', { name: '回退到节点页面', exact: true }).click();
    await expect(reader.locator('.answer-pane:not([hidden]) .markdown-preview')).toContainText("第一句话。");
    await reader.getByRole('button', { name: '完整打开概念：残差' }).click();
    await reader.locator(".concept-backlinks button").click();
    await expect(reader.locator('.answer-pane:not([hidden]) .markdown-preview')).toContainText("第一句话。");
    await expect(page.getByRole("button", { name: "打开概念：残差", exact: true })).toBeVisible();
    const source = await readFile(path.join(root, "answers", `${record.references[0]!.sourceAnswerId}.md`), "utf8");
    const note = await readFile(path.join(root, "answers", `${record.answerId}.md`), "utf8");
    expect(source).toContain(`](${record.answerId}.md)`);
    expect(note).toContain(`](${record.references[0]!.sourceAnswerId}.md)`);
    expect(note).toContain("tags:"); expect(note).toContain("概念");
    await reader.getByRole("button", { name: "关闭阅读窗口", exact: true }).click();
    await page.locator(".concept-node-card").dragTo(page.locator(".mindmap-canvas .smm-node").first());
    await expect(page.locator(".mindmap-canvas .smm-node", { hasText: "残差" })).toBeVisible();
    await page.keyboard.press("Control+s");
    await expect.poll(async () => {
      const manifest = JSON.parse(await readFile(path.join(root, "workspace.json"), "utf8"));
      const map = JSON.parse(await readFile(path.join(root, "projects", manifest.activeProjectId, "mindmap.json"), "utf8"));
      return map.children.find((node: { conceptId?: string }) => node.conceptId === record.id)?.tags;
    }).toEqual(["概念"]);
    await page.screenshot({ path: `test-results/${provider}-concept-node.png` });
    await page.getByRole("button", { name: "删除概念 残差", exact: true }).click();
    await page.getByRole("tab", { name: /垃圾箱/ }).click();
    await page.getByRole("button", { name: "恢复概念 残差", exact: true }).click();
    await page.locator(".node-tray-tabs").getByRole("tab", { name: /候选节点/ }).click();
    await expect(page.locator(".concept-node-card")).toHaveCount(1);
    // Exercise the original website entry through its sandboxed production preload.
    const sourceUrl = { chatgpt: "https://chatgpt.com/c/source", yuanbao: "https://yuanbao.tencent.com/chat/source", doubao: "https://www.doubao.com/chat/source" }[provider];
    await application.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === url)!;
      await contents.executeJavaScript(`(() => {
        const element = document.querySelector('p'); const node = element.firstChild;
        const index = node.textContent.indexOf('预测值'); const range = document.createRange();
        range.setStart(node,index);range.setEnd(node,index+3);
        const selection=document.getSelection();selection.removeAllRanges();selection.addRange(range);
        element.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));
      })()`);
    }, sourceUrl);
    await expect.poll(async () => application.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === url)!;
      return contents.executeJavaScript(`Boolean(document.querySelector('[aria-label="生成概念：预测值"]'))`);
    }, sourceUrl)).toBe(true);
    await application.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === url)!;
      await contents.executeJavaScript(`document.querySelector('[aria-label="生成概念：预测值"]').click()`);
    }, sourceUrl);
    await expect.poll(async () => (await page.evaluate(() => window.mindmapAI.concepts.get())).records.find((entry) => entry.title === "预测值")?.status, { timeout: 20000 }).toBe("ready");
    const prediction = (await page.evaluate(() => window.mindmapAI.concepts.get())).records.find((entry) => entry.title === "预测值")!;
    expect(prediction.prompt).toContain("残差是观测值与预测值之差。");
    expect(prediction.references[0]!.sourceAnswerId).toBe(record.references[0]!.sourceAnswerId);
    await application.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === url)!;
      await contents.executeJavaScript(`document.querySelectorAll('[data-message-id]').forEach(element => element.removeAttribute('data-message-id'))`);
    }, sourceUrl);
    await expect.poll(async () => application.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === url)!;
      return contents.executeJavaScript(`Boolean(document.querySelector('[aria-label="打开概念：预测值"]'))`);
    }, sourceUrl)).toBe(true);
    await application.evaluate(async ({ webContents }, url) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === url)!;
      await contents.executeJavaScript(`document.querySelector('[aria-label="打开概念：预测值"]').click()`);
    }, sourceUrl);
    await expect(reader).toBeVisible();
    await expect(reader.locator(".answer-heading strong")).toHaveText("预测值");
    await reader.getByRole("button", { name: "关闭阅读窗口", exact: true }).click();
    await application.close();
    application = await electron.launch({ args: [".", `--user-data-dir=${profile}`] });
    page = await application.firstWindow(); reader = page.getByLabel("回答阅读器");
    await expect(page.locator(".concept-node-card")).toHaveCount(2, { timeout: 15000 });
    expect((await page.evaluate(() => window.mindmapAI.concepts.get())).settings.background).toBe(true);
    const artifactDir = path.resolve("artifacts/concept-test"); await mkdir(artifactDir, { recursive: true });
    await copyFile(path.join(root, "answers", `${record.answerId}.md`), path.join(artifactDir, `${provider}-concept-note.md`));
  } finally {
    await application.close(); await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
  }
});
