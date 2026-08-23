// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ProjectNameDialog } from "../../src/renderer/src/components/ProjectNameDialog.js";

afterEach(() => document.body.replaceChildren());

describe("ProjectNameDialog", () => {
  test("submits a trimmed root-project name with Enter", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<ProjectNameDialog parentProjectId={null} onSubmit={onSubmit} onClose={vi.fn()} />);
    const input = screen.getByRole("textbox", { name: "主项目名称" });
    expect(input).toHaveValue("新项目");
    fireEvent.change(input, { target: { value: "  新研究  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith("新研究", null));
  });

  test("rejects a blank name and closes with Escape", () => {
    const onClose = vi.fn();
    const onSubmit = vi.fn();
    render(<ProjectNameDialog parentProjectId="parent-1" onSubmit={onSubmit} onClose={onClose} />);
    const input = screen.getByRole("textbox", { name: "子项目名称" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(screen.getByRole("alert")).toHaveTextContent("项目名称不能为空");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("keeps the dialog open and preserves input when creation fails", async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error("目录已存在"));
    const onClose = vi.fn();
    render(<ProjectNameDialog parentProjectId={null} onSubmit={onSubmit} onClose={onClose} />);
    const input = screen.getByRole("textbox", { name: "主项目名称" });
    fireEvent.change(input, { target: { value: "冲突项目" } });
    fireEvent.click(screen.getByRole("button", { name: "创建项目" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("目录已存在");
    expect(input).toHaveValue("冲突项目");
    expect(onClose).not.toHaveBeenCalled();
  });
});
