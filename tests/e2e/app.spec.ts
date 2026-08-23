import { _electron as electron, expect, test } from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function launchWithUserData(userDataDir: string) {
  return electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
}

test("boots the secure local workspace and exposes the typed bridge", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mindmap-ai-user-data-"));
  const application = await launchWithUserData(userDataDir);
  try {
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await expect(page).toHaveTitle("Mindmap AI");
    await expect(page.getByRole("heading", { name: /让一次 AI 回答/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "新建工作区" }).first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => typeof window.mindmapAI?.project?.open)).toBe("function");
    await page.screenshot({ path: "test-results/welcome.png" });
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("loads the sandboxed ChatGPT adapter and enters picker fallback", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mindmap-ai-user-data-"));
  const application = await launchWithUserData(userDataDir);
  try {
    await application.firstWindow();
    await expect.poll(() => application.evaluate(({ webContents }) =>
      webContents.getAllWebContents().some((contents) => contents.getURL().startsWith("https://chatgpt.com/"))
    ), { timeout: 15_000 }).toBe(true);
    await expect.poll(() => application.evaluate(async ({ webContents }) => {
      const chat = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://chatgpt.com/"));
      if (!chat) return false;
      return chat.executeJavaScript("Boolean(document.getElementById('mindmap-ai-hover-style'))") as Promise<boolean>;
    }), { timeout: 15_000 }).toBe(true);
    await application.evaluate(({ webContents }) => {
      const chat = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://chatgpt.com/"));
      chat?.send("ai:capture-latest");
    });
    await expect.poll(() => application.evaluate(async ({ webContents }) => {
      const chat = webContents.getAllWebContents().find((contents) => contents.getURL().startsWith("https://chatgpt.com/"));
      if (!chat) return false;
      return chat.executeJavaScript(`Boolean([...document.querySelectorAll('style')].find((element) => element.textContent.includes('mindmap-ai-pick-target')))`) as Promise<boolean>;
    })).toBe(true);
  } finally {
    await application.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("creates and renders the real docked mind-map workspace", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "mindmap-ai-e2e-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mindmap-ai-user-data-"));
  const application = await launchWithUserData(userDataDir);
  try {
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, projectDir);
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.getByRole("button", { name: "新建工作区", exact: true }).first().click();

    await expect(page.locator("#flexlayout-tabbutton-mindmap")).toBeVisible();
    await expect(page.getByText("ChatGPT 网页端", { exact: true })).toBeVisible();
    await expect(page.getByText("还没有候选节点", { exact: true })).toBeVisible();
    await expect(page.locator(".mindmap-canvas svg")).toBeVisible();
    await expect(page.getByText(path.basename(projectDir), { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "API 配置" }).click();
    await expect(page.getByRole("heading", { name: "API 配置" })).toBeVisible();
    await expect(page.getByLabel("Base URL")).toHaveValue("https://api.openai.com/v1");
    await page.screenshot({ path: "test-results/api-settings.png" });
    await page.getByRole("button", { name: "返回工作区" }).click();
    await expect(page.locator(".mindmap-canvas svg")).toBeVisible();

    const map = page.locator(".mindmap-canvas");
    await map.locator(".smm-node", { hasText: "中心主题" }).first().click();
    await map.locator(":scope > svg").hover();
    await page.keyboard.press("Tab");
    const editor = page.locator(".smm-node-edit-wrap:visible");
    await editor.fill("Child A");
    await page.keyboard.press("Enter");
    await expect(map.locator(".smm-node", { hasText: "Child A" })).toBeVisible();

    await map.locator(".smm-node", { hasText: "Child A" }).click();
    await map.locator(":scope > svg").hover();
    await page.keyboard.press("F2");
    await expect(page.getByRole("textbox", { name: "节点标题" })).toBeVisible();
    await expect(page.locator(".smm-node-edit-wrap:visible")).toHaveCount(0);
    await page.keyboard.press("Escape");

    await map.locator(".smm-node", { hasText: "Child A" }).click();
    await map.locator(":scope > svg").hover();
    await page.keyboard.press("Enter");
    await editor.fill("Sibling B");
    await page.keyboard.press("Enter");
    await expect(map.locator(".smm-node", { hasText: "Sibling B" })).toBeVisible();

    const canvasBounds = await map.boundingBox();
    if (!canvasBounds) throw new Error("Expected the map canvas to have bounds");
    const blankX = canvasBounds.x + canvasBounds.width - 24;
    const blankY = canvasBounds.y + canvasBounds.height - 24;
    await page.mouse.click(blankX, blankY);
    await page.mouse.move(blankX, blankY);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(blankX - 40, blankY - 30, { steps: 4 });
    await page.mouse.up({ button: "right" });
    await page.keyboard.press("Delete");
    await expect(map.locator(".smm-node", { hasText: "Child A" })).toBeVisible();
    await expect(map.locator(".smm-node", { hasText: "Sibling B" })).toBeVisible();

    await map.locator(".smm-node", { hasText: "Child A" }).click({ button: "right" });
    await expect(page.getByRole("menu", { name: "节点操作" })).toBeVisible();
    await page.keyboard.press("Escape");

    const childA = map.locator(".smm-node", { hasText: "Child A" });
    const siblingB = map.locator(".smm-node", { hasText: "Sibling B" });
    const boxes = await Promise.all([childA.boundingBox(), siblingB.boundingBox()]);
    if (!boxes[0] || !boxes[1]) throw new Error("Expected both map nodes to have bounds");
    const left = Math.max(canvasBounds.x + 2, Math.min(boxes[0].x, boxes[1].x) - 12);
    const top = Math.max(canvasBounds.y + 2, Math.min(boxes[0].y, boxes[1].y) - 12);
    const right = Math.min(
      canvasBounds.x + canvasBounds.width - 2,
      Math.max(boxes[0].x + boxes[0].width, boxes[1].x + boxes[1].width) + 12
    );
    const bottom = Math.min(
      canvasBounds.y + canvasBounds.height - 2,
      Math.max(boxes[0].y + boxes[0].height, boxes[1].y + boxes[1].height) + 12
    );
    await page.mouse.move(left, top);
    await page.mouse.down({ button: "left" });
    await page.mouse.move(right, bottom, { steps: 8 });
    await page.mouse.up({ button: "left" });
    await page.keyboard.press("Delete");
    await expect(childA).toHaveCount(0);
    await expect(siblingB).toHaveCount(0);

    await page.screenshot({ path: "test-results/workspace.png" });
    await page.getByRole("tab", { name: "样式" }).click();
    await page.getByRole("button", { name: /夜读/ }).click();
    await expect(page.getByRole("button", { name: /夜读/ })).toHaveClass(/selected/);
    await expect(page.locator(".save-state--dirty")).toBeVisible();
    await expect(page.locator(".save-state--saved")).toBeVisible({ timeout: 5_000 });
    const persistedWorkspace = JSON.parse(await readFile(path.join(projectDir, "workspace.json"), "utf8")) as { activeProjectId: string };
    const persistedProject = JSON.parse(await readFile(path.join(projectDir, "projects", persistedWorkspace.activeProjectId, "project.json"), "utf8")) as {
      state: { uiPreferences: { mindMapTheme?: string }; trash: Array<{ kind: string }> };
    };
    expect(persistedProject.state.uiPreferences.mindMapTheme).toBe("night");
    expect(persistedProject.state.trash.filter((entry) => entry.kind === "subtree")).toHaveLength(2);
    expect(errors).toEqual([]);
  } finally {
    await application.close();
    await rm(projectDir, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("captures a local answer, attaches it to the map, and opens the reader", async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), "mindmap-ai-flow-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mindmap-ai-user-data-"));
  const application = await launchWithUserData(userDataDir);
  try {
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, projectDir);
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
    await page.getByRole("button", { name: "新建工作区", exact: true }).first().click();
    await expect(page.locator(".mindmap-canvas svg")).toBeVisible();

    const answer = {
      metadata: {
        id: "answer-e2e",
        provider: "chatgpt" as const,
        title: "Captured integration answer",
        sourceUrl: "https://chatgpt.com/c/e2e",
        sourceMessageId: "message-e2e",
        contentHash: "a".repeat(64),
        capturedAt: "2026-08-17T00:00:00.000Z",
        updatedAt: "2026-08-17T00:00:00.000Z"
      },
      body: "## Captured integration answer\n\nA formula: $E = mc^2$\n\n$$x^2 + y^2 = z^2$$\n\n[![source](https://example.com/icon.svg) Source](https://example.com/report)\n\n| A | B |\n| - | - |\n| 1 | 2 |"
    };
    await page.evaluate((document) => window.mindmapAI.project.writeAnswer(document), answer);
    const candidateData = {
      id: "candidate-answer-e2e", answerId: answer.metadata.id, title: answer.metadata.title,
      extractionMode: "single" as const, children: [], createdAt: answer.metadata.capturedAt
    };
    await application.evaluate(({ BrowserWindow }, payload) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send("ai:answer-captured", payload);
    }, { status: "captured" as const, answer, candidate: candidateData });

    const candidate = page.locator(".node-tray-card", { hasText: answer.metadata.title });
    await expect(candidate).toBeVisible();
    const rootNode = page.locator(".mindmap-canvas svg text", { hasText: "中心主题" }).first();
    await candidate.dragTo(rootNode);

    await expect(candidate).toHaveCount(0);
    const answerNodeGroup = page.locator(".mindmap-canvas .smm-node", { hasText: answer.metadata.title }).first();
    await expect(answerNodeGroup).toBeVisible();
    await expect(answerNodeGroup.locator(".smm-node-note")).toBeVisible();
    await answerNodeGroup.dblclick();
    await expect.poll(() => errors).toEqual([]);
    await expect(page.getByLabel("回答阅读器")).toBeVisible();
    await expect(page.getByLabel("回答阅读器").locator(".katex")).toHaveCount(2);
    await expect(page.getByLabel("回答阅读器").locator(".katex-display")).toHaveCount(1);
    await expect(page.getByLabel("回答阅读器").locator("a > img")).toHaveCSS("width", "14px");
    await expect(page.getByLabel("回答阅读器").locator("a > img")).toHaveCSS("height", "14px");
    await expect(page.getByText("已保存", { exact: true })).toBeVisible({ timeout: 5_000 });

    const workspace = JSON.parse(await readFile(path.join(projectDir, "workspace.json"), "utf8")) as { activeProjectId: string };
    const activeProjectDir = path.join(projectDir, "projects", workspace.activeProjectId);
    const storedProject = JSON.parse(await readFile(path.join(activeProjectDir, "project.json"), "utf8")) as { state: { candidates: unknown[] } };
    const mindmap = JSON.parse(await readFile(path.join(activeProjectDir, "mindmap.json"), "utf8")) as {
      children: Array<{ answerId?: string }>;
    };
    expect(storedProject.state.candidates).toEqual([]);
    expect(mindmap.children[0]?.answerId).toBe(answer.metadata.id);
  } finally {
    await application.close();
    await rm(projectDir, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});

test("restores the last workspace after restart and switches to another recent workspace", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mindmap-ai-user-data-"));
  const firstWorkspace = await mkdtemp(path.join(tmpdir(), "mindmap-ai-first-"));
  const secondWorkspace = await mkdtemp(path.join(tmpdir(), "mindmap-ai-second-"));
  let application = await launchWithUserData(userDataDir);
  try {
    const actualUserData = await application.evaluate(({ app }) => app.getPath("userData"));
    expect(path.resolve(actualUserData)).toBe(path.resolve(userDataDir));
    let selectedPath = firstWorkspace;
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [(globalThis as { selectedWorkspace?: string }).selectedWorkspace!] });
    });
    await application.evaluate((_electron, value) => { (globalThis as { selectedWorkspace?: string }).selectedWorkspace = value; }, selectedPath);
    let page = await application.firstWindow();
    await page.getByRole("button", { name: "新建工作区", exact: true }).first().click();
    await expect(page.getByText(path.basename(firstWorkspace), { exact: true })).toBeVisible();

    selectedPath = secondWorkspace;
    await application.evaluate((_electron, value) => { (globalThis as { selectedWorkspace?: string }).selectedWorkspace = value; }, selectedPath);
    await page.getByRole("button", { name: "新建工作区", exact: true }).first().click();
    await expect(page.getByText(path.basename(secondWorkspace), { exact: true })).toBeVisible();
    await application.close();

    application = await launchWithUserData(userDataDir);
    page = await application.firstWindow();
    await expect(page.getByText(path.basename(secondWorkspace), { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "切换工作区" }).click();
    await expect(page.getByRole("dialog", { name: "切换工作区" })).toBeVisible();
    await page.getByRole("button", { name: `打开 ${path.basename(firstWorkspace)}` }).click();
    await expect(page.getByText(path.basename(firstWorkspace), { exact: true })).toBeVisible();
  } finally {
    await application.close().catch(() => undefined);
    await Promise.all([userDataDir, firstWorkspace, secondWorkspace].map((directory) =>
      rm(directory, { recursive: true, force: true })
    ));
  }
});
