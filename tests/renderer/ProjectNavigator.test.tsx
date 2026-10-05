// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProjectNavigator } from "../../src/renderer/src/components/ProjectNavigator.js";
import type { WorkspaceManifest } from "../../src/shared/types.js";

const ROOT_ID = "2cb66115-270c-4107-89e0-f61508c14d2b";
const CHILD_ID = "f93a5f49-b715-4765-baf9-124dd2fe7436";
const NOW = "2026-08-18T00:00:00.000Z";

const workspace: WorkspaceManifest = {
  schemaVersion: 2,
  workspaceId: "9dfd4da9-f0c8-4fbe-bf3c-cb199b576ddd",
  name: "Research",
  activeProjectId: CHILD_ID,
  projects: [
    { projectId: ROOT_ID, parentProjectId: null, name: "Root", order: 0, createdAt: NOW, updatedAt: NOW },
    { projectId: CHILD_ID, parentProjectId: ROOT_ID, name: "Child", order: 0, createdAt: NOW, updatedAt: NOW }
  ],
  projectTrash: [],
  createdAt: NOW,
  updatedAt: NOW
};

afterEach(() => document.body.replaceChildren());

describe("ProjectNavigator", () => {
  test("accepts moving a child to workspace root and rejects circular drops", () => {
    const onReparent = vi.fn();
    render(<ProjectNavigator workspace={workspace} onReparent={onReparent} onSwitch={vi.fn()} onCreate={vi.fn()} onRename={vi.fn()} onOpenInExplorer={vi.fn()} onOpenApiSettings={vi.fn()} />);
    const dataTransfer = { setData: vi.fn(), getData: () => CHILD_ID, effectAllowed: "", dropEffect: "" };
    const child = screen.getByRole("treeitem", { name: "Child", exact: true }).querySelector(".project-row")!;
    fireEvent.dragStart(child, { dataTransfer });
    fireEvent.drop(screen.getByLabelText("移为主项目"), { dataTransfer });
    expect(onReparent).toHaveBeenCalledWith(CHILD_ID, null);
    onReparent.mockClear();
    dataTransfer.getData = () => ROOT_ID;
    fireEvent.dragStart(screen.getByRole("treeitem", { name: "Root", exact: true }).querySelector(".project-row")!, { dataTransfer });
    fireEvent.drop(child, { dataTransfer });
    expect(onReparent).not.toHaveBeenCalled();
  });
  test("renders nested projects, active state, and breadcrumbs", () => {
    render(<ProjectNavigator
      workspace={workspace}
      onSwitch={vi.fn()}
      onCreate={vi.fn()}
      onRename={vi.fn()}
      onOpenInExplorer={vi.fn()}
      onOpenApiSettings={vi.fn()}
    />);
    const tree = screen.getByRole("tree", { name: "项目" });
    expect(within(tree).getAllByRole("treeitem")).toHaveLength(2);
    expect(screen.getByRole("treeitem", { name: /Child/ })).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("项目路径")).toHaveTextContent("Root / Child");
  });

  test("switches, creates root and child projects, and collapses a branch", () => {
    const onSwitch = vi.fn();
    const onCreate = vi.fn();
    render(<ProjectNavigator
      workspace={workspace}
      onSwitch={onSwitch}
      onCreate={onCreate}
      onRename={vi.fn()}
      onOpenInExplorer={vi.fn()}
      onOpenApiSettings={vi.fn()}
    />);
    fireEvent.click(screen.getByText("Root"));
    expect(onSwitch).toHaveBeenCalledWith(ROOT_ID);
    fireEvent.click(screen.getByRole("button", { name: "新建主项目" }));
    expect(onCreate).toHaveBeenCalledWith(null);

    fireEvent.click(screen.getByRole("button", { name: "项目操作 Root" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "创建子项目" }));
    expect(onCreate).toHaveBeenCalledWith(ROOT_ID);

    fireEvent.click(screen.getByRole("button", { name: "折叠 Root" }));
    expect(screen.queryByRole("treeitem", { name: /Child/ })).not.toBeInTheDocument();
  });

  test("renames inline and opens the stable project folder", () => {
    const onRename = vi.fn();
    const onOpenInExplorer = vi.fn();
    render(<ProjectNavigator
      workspace={workspace}
      onSwitch={vi.fn()}
      onCreate={vi.fn()}
      onRename={onRename}
      onOpenInExplorer={onOpenInExplorer}
      onOpenApiSettings={vi.fn()}
    />);
    fireEvent.click(screen.getByRole("button", { name: "项目操作 Child" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名" }));
    const input = screen.getByRole("textbox", { name: "重命名 Child" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith(CHILD_ID, "Renamed");

    fireEvent.click(screen.getByRole("button", { name: "项目操作 Child" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "在资源管理器中打开" }));
    expect(onOpenInExplorer).toHaveBeenCalledWith(CHILD_ID);
  });

  test("opens the API configuration page from the fixed footer action", () => {
    const onOpenApiSettings = vi.fn();
    render(<ProjectNavigator
      workspace={workspace}
      onSwitch={vi.fn()}
      onCreate={vi.fn()}
      onRename={vi.fn()}
      onOpenInExplorer={vi.fn()}
      onOpenApiSettings={onOpenApiSettings}
    />);
    fireEvent.click(screen.getByRole("button", { name: "API 配置" }));
    expect(onOpenApiSettings).toHaveBeenCalledTimes(1);
  });
});
