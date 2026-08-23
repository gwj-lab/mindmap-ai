// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AiPanel } from "../../src/renderer/src/components/AiPanel.js";

describe("AI panel capture controls", () => {
  const ai = {
    setPanelBounds: vi.fn(), setPanelVisible: vi.fn(), captureLatest: vi.fn(), pickAnswer: vi.fn(),
    setHoverCapture: vi.fn(), beginLocalDrag: vi.fn(), endLocalDrag: vi.fn()
  };
  beforeEach(() => {
    Object.assign(window, { mindmapAI: { ai } });
    vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
    vi.stubGlobal("IntersectionObserver", class { observe(): void {} disconnect(): void {} });
    Object.values(ai).forEach((mock) => mock.mockClear());
  });
  afterEach(() => document.body.replaceChildren());
  test("switches capture modes and forwards hover state", () => {
    const onCaptureModeChange = vi.fn();
    const onAutoHoverCaptureChange = vi.fn();
    render(<AiPanel autoHoverCapture captureMode="single" onCaptureModeChange={onCaptureModeChange} onAutoHoverCaptureChange={onAutoHoverCaptureChange} onOpenSettings={vi.fn()} />);
    expect(screen.getByRole("checkbox", { name: "悬停识别，双击捕获" })).not.toBeNull();
    expect(ai.setHoverCapture).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: "生成子节点" }));
    expect(onCaptureModeChange).toHaveBeenCalledWith("expanded");
    fireEvent.click(screen.getByRole("checkbox", { name: "悬停识别，双击捕获" }));
    expect(onAutoHoverCaptureChange).toHaveBeenCalledWith(false);
  });
  test("offers latest and point-select capture separately", () => {
    render(<AiPanel autoHoverCapture captureMode="single" onCaptureModeChange={vi.fn()} onAutoHoverCaptureChange={vi.fn()} onOpenSettings={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "捕获最新回答" }));
    fireEvent.click(screen.getByRole("button", { name: "点选回答" }));
    expect(ai.captureLatest).toHaveBeenCalledTimes(1);
    expect(ai.pickAnswer).toHaveBeenCalledTimes(1);
  });

  test("forwards the settings shortcut instead of owning another settings surface", () => {
    const onOpenSettings = vi.fn();
    render(<AiPanel autoHoverCapture captureMode="single" onCaptureModeChange={vi.fn()} onAutoHoverCaptureChange={vi.fn()} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole("button", { name: "AI 设置" }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "AI 提取设置" })).not.toBeInTheDocument();
  });
});
