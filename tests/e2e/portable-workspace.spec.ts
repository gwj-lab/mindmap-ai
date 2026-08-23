import { _electron as electron, expect, test } from "@playwright/test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("creates a child project and reopens it from portable Markdown recovery", async () => {
  const workspaceDir = await mkdtemp(path.join(tmpdir(), "mindmap-ai-portable-"));
  let application = await electron.launch({ args: ["."] });
  try {
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, workspaceDir);
    let page = await application.firstWindow();
    await page.getByRole("button", { name: "新建工作区", exact: true }).first().click();
    await expect(page.getByRole("treeitem", { name: "主项目" })).toBeVisible();
    await page.getByRole("button", { name: "项目操作 主项目" }).click();
    await page.getByRole("menuitem", { name: /创建子项目/ }).click();
    await page.getByRole("textbox", { name: "子项目名称" }).fill("研究子项目");
    await page.getByRole("button", { name: "创建项目" }).click();
    await expect(page.getByRole("treeitem", { name: "研究子项目" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByLabel("项目路径")).toContainText("主项目 / 研究子项目");
    await expect(page.locator(".save-state--saved")).toBeVisible({ timeout: 5_000 });

    const manifest = JSON.parse(await readFile(path.join(workspaceDir, "workspace.json"), "utf8")) as { activeProjectId: string };
    const projectDir = path.join(workspaceDir, "projects", manifest.activeProjectId);
    await access(path.join(projectDir, "map.md"));
    await access(path.join(projectDir, "project.json"));
    await rm(path.join(projectDir, "mindmap.json"));
    await application.close();

    application = await electron.launch({ args: ["."] });
    await application.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] });
    }, workspaceDir);
    page = await application.firstWindow();
    await page.getByRole("button", { name: "打开工作区", exact: true }).first().click();
    await expect(page.getByRole("treeitem", { name: "研究子项目" })).toHaveAttribute("aria-current", "page");
    await expect(page.locator(".mindmap-canvas svg")).toBeVisible();
    await access(path.join(projectDir, "mindmap.json"));
  } finally {
    await application.close().catch(() => undefined);
    await rm(workspaceDir, { recursive: true, force: true });
  }
});
