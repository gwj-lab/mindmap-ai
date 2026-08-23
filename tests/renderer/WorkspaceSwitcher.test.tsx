// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WorkspaceSwitcher } from "../../src/renderer/src/components/WorkspaceSwitcher.js";

describe("WorkspaceSwitcher", () => {
  afterEach(() => document.body.replaceChildren());

  test("switches, forgets, and exposes folder fallback actions", () => {
    const onSwitch = vi.fn();
    const onForget = vi.fn();
    const onOpen = vi.fn();
    const onCreate = vi.fn();
    render(<WorkspaceSwitcher
      entries={[{
        id: "7ca134b0-2c87-46e6-92c8-6bdde8a69c37",
        name: "Research",
        path: "C:\\Research",
        lastOpenedAt: "2026-08-23T00:00:00.000Z"
      }]}
      onClose={vi.fn()}
      onSwitch={onSwitch}
      onForget={onForget}
      onOpen={onOpen}
      onCreate={onCreate}
    />);

    expect(screen.getByRole("dialog", { name: "切换工作区" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "打开 Research" }));
    expect(onSwitch).toHaveBeenCalledWith("7ca134b0-2c87-46e6-92c8-6bdde8a69c37");
    fireEvent.click(screen.getByRole("button", { name: "从最近列表移除 Research" }));
    expect(onForget).toHaveBeenCalledWith("7ca134b0-2c87-46e6-92c8-6bdde8a69c37");
    fireEvent.click(screen.getByRole("button", { name: "打开其他文件夹" }));
    fireEvent.click(screen.getByRole("button", { name: "新建工作区" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });
});
