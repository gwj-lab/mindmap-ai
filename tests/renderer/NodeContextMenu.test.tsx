// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { NodeContextMenu } from "../../src/renderer/src/components/NodeContextMenu.js";
import { isEditableTarget } from "../../src/renderer/src/keyboard.js";

afterEach(() => document.body.replaceChildren());

function props(overrides: Partial<React.ComponentProps<typeof NodeContextMenu>> = {}) {
  return {
    x: 10,
    y: 20,
    nodeUid: "node-1",
    title: "Node",
    answerId: "answer-1",
    isRoot: false,
    onClose: vi.fn(),
    onRename: vi.fn(),
    onCreateChild: vi.fn(),
    onCreateSibling: vi.fn(),
    onMoveToHistory: vi.fn(),
    onDelete: vi.fn(),
    onOpenAnswer: vi.fn(),
    ...overrides
  };
}

describe("NodeContextMenu", () => {
  test("offers rename and delete and clamps to the viewport", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 300 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 260 });
    const callbacks = props({ x: 290, y: 250 });
    render(<NodeContextMenu {...callbacks} />);
    const menu = screen.getByRole("menu", { name: "节点操作" });
    expect(Number.parseInt(menu.style.left)).toBeLessThan(290);
    expect(Number.parseInt(menu.style.top)).toBeLessThan(250);
    fireEvent.click(screen.getByRole("menuitem", { name: "删除节点" }));
    expect(callbacks.onDelete).toHaveBeenCalledWith("node-1");
  });

  test("renames inline and closes on Escape", () => {
    const callbacks = props();
    render(<NodeContextMenu {...callbacks} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "重命名节点标题" }));
    const input = screen.getByRole("textbox", { name: "节点标题" });
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(callbacks.onRename).toHaveBeenCalledWith("node-1", "Renamed");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  test("disables root removal and shows open only for answer nodes", () => {
    render(<NodeContextMenu {...props({ isRoot: true, answerId: undefined })} />);
    expect(screen.getByRole("menuitem", { name: "移到历史节点" })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: "删除节点" })).toBeDisabled();
    expect(screen.queryByRole("menuitem", { name: "打开关联回答" })).not.toBeInTheDocument();
  });

  test("recognizes text-editing targets for shortcut suppression", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isEditableTarget(editable)).toBe(true);
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
