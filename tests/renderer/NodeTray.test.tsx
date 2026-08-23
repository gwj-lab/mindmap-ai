// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NodeTray } from "../../src/renderer/src/components/NodeTray.js";
import type { CandidateNode, HistoryEntry, ProjectTrashEntry } from "../../src/shared/types.js";

const candidate: CandidateNode = {
  id: "candidate-1",
  answerId: "answer-1",
  title: "Main title",
  extractionMode: "expanded",
  children: [{ id: "child-a", title: "Child A" }, { id: "child-b", title: "Child B" }],
  createdAt: "2026-08-18T00:00:00.000Z"
};
const history: HistoryEntry = {
  id: "history-1",
  subtree: { uid: "branch", text: "Old branch", answerId: "answer-2", children: [] },
  originalParentUid: "root",
  originalIndex: 0,
  movedAt: "2026-08-18T00:00:00.000Z"
};
const trash: ProjectTrashEntry = {
  kind: "candidate",
  id: "trash-1",
  deletedAt: "2026-08-18T00:00:00.000Z",
  candidate: { ...candidate, id: "deleted-candidate" }
};

function callbacks() {
  return {
    onUpdateCandidate: vi.fn(),
    onDeleteCandidate: vi.fn(),
    onDeleteHistory: vi.fn(),
    onRestoreTrash: vi.fn(),
    onPermanentDelete: vi.fn(),
    onMapSubtreeDrop: vi.fn()
  };
}

afterEach(() => document.body.replaceChildren());

describe("NodeTray", () => {
  test("shows tab counts and edits expanded candidate children", () => {
    const actions = callbacks();
    render(<NodeTray candidates={[candidate]} history={[history]} trash={[trash]} {...actions} />);
    expect(screen.getByRole("tab", { name: /候选节点 1/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "展开 Main title" }));
    expect(screen.getByRole("textbox", { name: "子节点标题 Child A" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "候选标题 Main title" }), { target: { value: "Edited root" } });
    expect(actions.onUpdateCandidate).toHaveBeenCalledWith(expect.objectContaining({ title: "Edited root" }));
    fireEvent.change(screen.getByRole("textbox", { name: "子节点标题 Child A" }), { target: { value: "Edited child" } });
    expect(actions.onUpdateCandidate).toHaveBeenCalledWith(expect.objectContaining({
      children: expect.arrayContaining([expect.objectContaining({ id: "child-a", title: "Edited child" })])
    }));
    fireEvent.click(screen.getByRole("button", { name: "上移 Child B" }));
    expect(actions.onUpdateCandidate).toHaveBeenCalledWith(expect.objectContaining({
      children: [{ id: "child-b", title: "Child B" }, { id: "child-a", title: "Child A" }]
    }));
    fireEvent.click(screen.getByRole("button", { name: "删除候选 Main title" }));
    expect(actions.onDeleteCandidate).toHaveBeenCalledWith("candidate-1");
  });

  test("shows history, accepts map subtree drops, and deletes history", () => {
    const actions = callbacks();
    render(<NodeTray candidates={[candidate]} history={[history]} trash={[trash]} {...actions} />);
    fireEvent.click(screen.getByRole("tab", { name: /历史节点 1/ }));
    expect(screen.getByText("Old branch")).toBeInTheDocument();
    const panel = screen.getByRole("tabpanel", { name: "历史节点" });
    const dataTransfer = {
      types: ["application/x-mindmap-subtree"],
      getData: vi.fn(() => "branch"),
      dropEffect: "none"
    };
    fireEvent.dragOver(panel, { dataTransfer });
    fireEvent.drop(panel, { dataTransfer });
    expect(actions.onMapSubtreeDrop).toHaveBeenCalledWith("branch");
    fireEvent.click(screen.getByRole("button", { name: "删除历史 Old branch" }));
    expect(actions.onDeleteHistory).toHaveBeenCalledWith("history-1");
  });

  test("restores or permanently removes trash records", () => {
    const actions = callbacks();
    render(<NodeTray candidates={[candidate]} history={[history]} trash={[trash]} {...actions} />);
    fireEvent.click(screen.getByRole("tab", { name: /垃圾箱 1/ }));
    fireEvent.click(screen.getByRole("button", { name: "恢复 Main title" }));
    expect(actions.onRestoreTrash).toHaveBeenCalledWith("trash-1");
    fireEvent.click(screen.getByRole("button", { name: "彻底删除 Main title" }));
    expect(actions.onPermanentDelete).toHaveBeenCalledWith("trash-1");
  });
});
