import { _electron as electron, expect, test } from "@playwright/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { WorkspaceStore } from "../../src/main/workspace-store.js";

test("records interaction timings with a 1000-node, 100-project workspace", async () => {
  test.setTimeout(180_000);
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "mindmap-perf-workspace-"));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mindmap-perf-profile-"));
  let application: Awaited<ReturnType<typeof electron.launch>> | null = null;
  try {
    const store = new WorkspaceStore(workspaceDir);
    const initialized = await store.initialize(path.basename(workspaceDir), "Main project");
    const projectId = initialized.project.manifest.projectId;
    const timestamp = new Date().toISOString();
    let nextNode = 0;
    type PerformanceNode = { uid: string; text: string; answerId: string; children: PerformanceNode[] };
    const makeNode = (text: string, children: PerformanceNode[] = []): PerformanceNode => {
      const index = nextNode++;
      return { uid: `perf-node-${index}`, text, answerId: `perf-answer-${index}`, children };
    };
    const groups = Array.from({ length: 10 }, (_, groupIndex) => {
      const group = makeNode(`Perf node ${String(groupIndex).padStart(4, "0")}`);
      group.children.push(...Array.from({ length: 10 }, (_, childIndex) => {
        const nodeIndex = nextNode;
        const children = Array.from({ length: groupIndex * 10 + childIndex < 90 ? 9 : 8 }, (_, leafIndex) =>
          makeNode(`Perf leaf ${groupIndex}-${childIndex}-${leafIndex}`));
        return makeNode(`Perf node ${String(nodeIndex).padStart(4, "0")}`, children);
      }));
      return group;
    });
    if (nextNode !== 1000) throw new Error(`Performance fixture contains ${nextNode} nodes`);
    const codeFence = "`".repeat(3);
    const longBody = `${Array.from({ length: 100 }, (_, index) => `Formula ${index}\n\n$$x_${index}^2 + y_${index}^2 = z_${index}^2$$\n\n| A | B |\n| --- | --- |\n| ${index} | value |\n\n${codeFence}ts\nconst value${index} = ${index};\n${codeFence}\n`).join("\n")}${"Performance fixture paragraph. ".repeat(1500)}`;
    const project = { ...initialized.project, mindmap: { uid: "perf-root", text: "Performance fixture", children: groups } };
    await store.saveActive(project);

    const answerFiles = Array.from({ length: 1000 }, (_, index) => {
      const id = `perf-answer-${index}`;
      const body = index === 0 ? longBody : "Performance fixture.";
      const frontmatter = [
        "---", `id: ${id}`, "provider: chatgpt", `title: Performance answer ${index}`,
        "sourceUrl: https://chatgpt.com/c/perf", `sourceMessageId: perf-message-${index}`,
        `contentHash: ${"a".repeat(64)}`, `capturedAt: ${timestamp}`, `updatedAt: ${timestamp}`, "---", body
      ].join("\n");
      return [id, frontmatter] as const;
    });
    const answersDir = path.join(workspaceDir, "answers");
    for (let offset = 0; offset < answerFiles.length; offset += 100) {
      await Promise.all(answerFiles.slice(offset, offset + 100).map(([id, content]) =>
        writeFile(path.join(answersDir, `${id}.md`), content)));
    }

    const workspace = store.getSummary();
    const rootRecord = workspace.projects[0]!;
    const projects = [rootRecord];
    for (let index = 1; index < 100; index += 1) {
      const childId = randomUUID();
      const childName = `Perf project ${index}`;
      const childDir = path.join(workspaceDir, "projects", childId);
      const createdAt = timestamp;
      await mkdir(childDir, { recursive: true });
      projects.push({ projectId: childId, parentProjectId: null, name: childName, order: index, createdAt, updatedAt: timestamp });
      const childMindmap = {
        uid: `${childId}-root`,
        text: childName,
        children: index === 1 ? Array.from({ length: 199 }, (_, childIndex) => ({
          uid: `${childId}-node-${childIndex}`,
          text: `Perf 200 node ${childIndex}`,
          children: []
        })) : []
      };
      await Promise.all([
        writeFile(path.join(childDir, "project.json"), JSON.stringify({
          manifest: { ...initialized.project.manifest, projectId: childId, name: childName, createdAt, updatedAt: timestamp },
          state: initialized.project.state
        })),
        writeFile(path.join(childDir, "mindmap.json"), JSON.stringify(childMindmap))
      ]);
    }
    await writeFile(path.join(workspaceDir, "workspace.json"), `${JSON.stringify({ ...workspace, projects, updatedAt: timestamp }, null, 2)}\n`);

    application = await electron.launch({ args: [".", `--user-data-dir=${userDataDir}`] });
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, workspaceDir);
    const page = await application.firstWindow();
    page.setDefaultTimeout(20_000);
    await page.getByRole("button", { name: "打开工作区", exact: true }).first().click();
    await expect(page.locator(".mindmap-canvas .smm-node")).toHaveCount(1001, { timeout: 60_000 });

    const switch200Started = Date.now();
    await page.locator(".project-row[data-project-id]").nth(1).locator(".project-name").click();
    await expect(page.getByLabel("项目路径")).toContainText("Perf project 1");
    await expect(page.locator(".mindmap-canvas .smm-node")).toHaveCount(200, { timeout: 15_000 });
    const switch200Ms = Date.now() - switch200Started;
    const switch1000Started = Date.now();
    await page.locator(`.project-row[data-project-id="${projectId}"] .project-name`).click();
    await expect(page.locator(".mindmap-canvas .smm-node")).toHaveCount(1001, { timeout: 30_000 });
    const switch1000Ms = Date.now() - switch1000Started;

    const target = page.locator(".mindmap-canvas .smm-node", { hasText: "Perf node 0000" }).first();
    const editStarted = Date.now();
    await target.dblclick();
    await expect(page.getByLabel("回答阅读器")).toBeVisible();
    const answerOpenMs = Date.now() - editStarted;
    await expect(page.getByLabel("回答阅读器")).toContainText("Performance answer 0");
    const previewStarted = Date.now();
    await expect(page.locator(".markdown-preview .katex-display")).toHaveCount(100, { timeout: 15_000 });
    const markdownPreviewMs = Date.now() - previewStarted;
    const dragStarted = Date.now();
    await page.getByLabel("回答阅读器").locator("header").hover();
    await page.mouse.down();
    await page.mouse.move(240, 170, { steps: 8 });
    await page.mouse.up();
    const readerDragMs = Date.now() - dragStarted;
    await page.getByRole("button", { name: "编辑" }).click();
    const input = page.locator(".cm-content");
    const typingStarted = Date.now();
    await input.press("End");
    await input.pressSequentially("benchmark input");
    const typingMs = Date.now() - typingStarted;
    await expect(page.locator(".markdown-preview")).toContainText("benchmark input", { timeout: 5_000 });

    const report = {
      scale: { nodes: 1000, projects: 100, answers: 1000, longAnswerBytes: Buffer.byteLength(longBody) },
      measurementsMs: { switchAndRender200Nodes: switch200Ms, switchAndRender1000Nodes: switch1000Ms, answerOpen: answerOpenMs, markdownPreview: markdownPreviewMs, readerDrag: readerDragMs, editorTyping: typingMs }
    };
    await mkdir("test-results", { recursive: true });
    await writeFile(path.join("test-results", "performance-baseline.json"), `${JSON.stringify(report, null, 2)}\n`);
    expect(report.scale.longAnswerBytes).toBeGreaterThanOrEqual(50_000);
  } finally {
    await application?.close();
    await rm(workspaceDir, { recursive: true, force: true });
    await rm(userDataDir, { recursive: true, force: true });
  }
});
