import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "../../src/main/workspace-store.js";
import { contentHash } from "../../src/shared/content.js";
import { DEFAULT_CONCEPT_SETTINGS, type ConceptRecord } from "../../src/shared/concepts.js";

test("manages independent readers, maximizes, previews concepts and returns with reading position intact", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "mindmap-readers-"));
  const profile = await mkdtemp(path.join(tmpdir(), "mindmap-readers-profile-"));
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const store = new WorkspaceStore(root);
    const initialized = await store.initialize("半导体研究", "射频材料笔记");
    const sourceBody = "# GaAs 高频器件\n\n砷化镓适合微波与毫米波电路，兼顾信号响应和低噪声。\n\n## 材料与性能\n\n电子迁移率决定载流子在电场中的运动能力。\n\n截止频率衡量器件在高频下的放大能力。\n\n噪声系数描述器件带来的额外信号噪声。\n\n异质结用于约束电子并改善输运性能。\n\n## 为什么适合高频？\n\n较高的迁移能力使电子更快地响应电场变化，在射频前端中有助于获得更好的增益和噪声表现。\n\n| 材料 | 典型用途 |\n| --- | --- |\n| GaAs | 低噪声放大器、射频开关 |\n| Si | 数字集成电路 |\n\n" + Array.from({ length: 10 }, (_, index) => `### 研究笔记 ${index + 1}\n\n比较材料时，需要同时考虑工艺、结构与使用频段。材料参数只是起点，实际表现仍取决于器件设计。`).join("\n\n");
    const titles = ["GaAs 高频器件", "射频系统", "器件结构"];
    const ids = ["source", "system", "structure"];
    const now = new Date().toISOString();
    const writeNote = async (id: string, title: string, body: string, conceptId?: string): Promise<void> => {
      await store.answers.write({ metadata: { id, title, provider: "chatgpt", sourceUrl: "https://chatgpt.com/c/research", sourceMessageId: "research", contentHash: await contentHash(body), capturedAt: now, updatedAt: now, ...(conceptId ? { conceptId, tags: ["概念"] } : {}) }, body });
    };
    await writeNote(ids[0], titles[0], sourceBody);
    await writeNote(ids[1], titles[1], "# 射频系统\n\n从天线到接收链路，信号会经过滤波、放大与混频。\n\n## 系统指标\n\n关注带宽、增益和动态范围。\n\n这篇笔记可以与材料笔记并排阅读。");
    await writeNote(ids[2], titles[2], "# 器件结构\n\n器件的几何结构、接触电阻与寄生电容共同影响工作频率。");
    const records: ConceptRecord[] = [];
    const concepts = [
      ["电子迁移率", "决定载流子在电场中的运动能力。", "迁移率描述电子对电场的响应能力。", "## 在 GaAs 语境中的作用\n\n较高的迁移率有利于快速响应，从而支持高频、低噪声器件。\n\n- 高频：缩短信号响应时间\n- 低噪声：改善输运条件\n- 应用：射频前端与低噪声放大器"],
      ["截止频率", "衡量器件在高频下的放大能力。", "频率升高时，器件增益逐渐下降。", "截止频率提供一个比较高频性能的尺度。"],
      ["噪声系数", "描述器件带来的额外信号噪声。", "噪声系数用于衡量信噪比劣化。", "低噪声放大器位于接收链路前端，表现会影响整个系统。"],
      ["异质结", "用于约束电子并改善输运性能。", "异质结由不同半导体材料构成。", "能带差异可以约束载流子，形成适合高速输运的通道。"]
    ];
    for (const [title, suffix, explanation, details] of concepts) {
      const id = randomUUID(); const answerId = `concept-${id}`;
      records.push({ id, answerId, title, provider: "chatgpt", status: "ready", tabId: `concept-tab-${id}`, prompt: "", createdAt: now,
        references: [{ sourceAnswerId: "source", sourceTitle: titles[0], projectId: initialized.project.manifest.projectId, sourceUrl: "https://chatgpt.com/c/research", sourceMessageId: "research", selection: { text: title, sentence: title + suffix, prefix: "", suffix } }] });
      await writeNote(answerId, title, `# ${title}\n\n${explanation}\n\n${details}\n\n---\n\n来源：[GaAs 高频器件](source.md)`, id);
    }
    await store.saveActive({ ...initialized.project, mindmap: { uid: "root", text: "半导体研究", children: ids.map((answerId, index) => ({ uid: `node-${index}`, text: titles[index], answerId, children: [] })) } });
    await writeFile(path.join(root, "concepts.json"), JSON.stringify({ settings: DEFAULT_CONCEPT_SETTINGS, records }));
    application = await electron.launch({ args: [".", `--user-data-dir=${profile}`] });
    await application.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); }, root);
    const page = await application.firstWindow();
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    await page.getByRole("button", { name: "打开工作区", exact: true }).first().click();
    const node = (title: string) => page.locator(".mindmap-canvas .smm-node", { hasText: title });
    await node(titles[0]).dblclick();
    const sourceReader = page.locator('.answer-dialog').filter({ has: page.locator('[data-answer-id="source"]') });
    await expect(sourceReader).toBeVisible();
    await sourceReader.getByRole("button", { name: "电子迁移率", exact: true }).click();
    await expect(sourceReader.locator('.concept-tab-preview')).toContainText("迁移率描述电子对电场的响应能力。");
    expect(await sourceReader.locator('.concept-tab').count()).toBe(4);
    const sourcePreview = sourceReader.locator('[data-answer-id="source"] .markdown-preview');
    await sourcePreview.evaluate((element) => { element.scrollTop = 200; });
    const scrollTop = await sourcePreview.evaluate((element) => element.scrollTop);
    await sourceReader.getByRole('button', { name: '完整打开概念：电子迁移率' }).click();
    await expect(sourceReader.locator('.answer-pane:not([hidden])')).toContainText('迁移率描述电子对电场的响应能力。');
    await sourceReader.getByRole('button', { name: '回退到节点页面' }).click();
    expect(await sourcePreview.evaluate((element) => element.scrollTop)).toBe(scrollTop);
    await sourcePreview.evaluate((element) => { element.scrollTop = 0; });
    const artifactDir = path.resolve('artifacts/reader-workspace'); await mkdir(artifactDir, { recursive: true });
    const originalBounds = await sourceReader.boundingBox();
    await sourceReader.getByRole('button', { name: '最大化窗口' }).click();
    await expect(sourceReader).toHaveClass(/answer-dialog--maximized/);
    const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const maximized = await sourceReader.boundingBox();
    expect(Math.abs(maximized!.width - (viewport.width - 16))).toBeLessThan(1); expect(Math.abs(maximized!.height - (viewport.height - 112))).toBeLessThan(1);
    await page.screenshot({ path: path.join(artifactDir, 'concept-sidebar-maximized.png') });
    await sourceReader.getByRole('button', { name: '还原窗口' }).click();
    expect(await sourceReader.boundingBox()).toEqual(originalBounds);
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    await node(titles[1]).dblclick();
    await expect(page.locator('.answer-dialog:not([hidden])')).toHaveCount(2);
    await page.getByRole('button', { name: `切换阅读窗口：${titles[0]}` }).click();
    await expect(sourceReader).toHaveClass(/answer-dialog--active/);
    await expect(sourceReader.locator('.concept-tab-preview')).toContainText('迁移率描述电子对电场的响应能力。');
    await page.getByRole('button', { name: '返回工作区', exact: true }).click();
    await node(titles[0]).dblclick();
    await expect(page.locator('.answer-dialog')).toHaveCount(2);
    // Arrange both readers using the native resize handle and title-bar dragging.
    let bounds = (await sourceReader.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width - 3, bounds.y + bounds.height - 3);
    await page.mouse.down(); await page.mouse.move(bounds.x + 760 - 3, bounds.y + bounds.height - 3); await page.mouse.up();
    expect((await sourceReader.boundingBox())!.width).toBeLessThan(bounds.width);
    let header = (await sourceReader.locator('.answer-pane:not([hidden]) .answer-heading').boundingBox())!;
    await page.mouse.move(header.x + 20, header.y + 10); await page.mouse.down(); await page.mouse.move(header.x - 20, header.y + 10); await page.mouse.up();
    await page.getByRole('button', { name: `切换阅读窗口：${titles[1]}` }).click();
    const systemReader = page.locator('.answer-dialog').filter({ has: page.locator('[data-answer-id="system"]') });
    await systemReader.getByRole('button', { name: '收起概念侧栏' }).click();
    bounds = (await systemReader.boundingBox())!;
    await page.mouse.move(bounds.x + bounds.width - 3, bounds.y + bounds.height - 3);
    await page.mouse.down(); await page.mouse.move(bounds.x + 660 - 3, bounds.y + bounds.height - 3); await page.mouse.up();
    header = (await systemReader.locator('.answer-heading').boundingBox())!;
    await page.mouse.move(header.x + 20, header.y + 10); await page.mouse.down(); await page.mouse.move(header.x + 20 + 800 - bounds.x, header.y + 10); await page.mouse.up();
    await page.screenshot({ path: path.join(artifactDir, 'multiple-readers.png') });
    await sourceReader.getByRole('button', { name: '关闭阅读窗口' }).click();
    await expect(page.locator('.answer-dialog')).toHaveCount(1);
    await page.locator('.answer-dialog').getByRole('button', { name: '关闭阅读窗口' }).click();
    await expect(page.getByLabel('阅读窗口管理')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await application?.close(); await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true });
  }
});
