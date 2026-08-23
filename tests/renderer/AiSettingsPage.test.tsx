// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AiSettingsPage } from "../../src/renderer/src/components/AiSettingsPage.js";

describe("AiSettingsPage", () => {
  const settings = {
    getPublicSettings: vi.fn().mockResolvedValue({ baseUrl: "https://api.example.com/v1", model: "small-model", hasApiKey: true }),
    updatePublicSettings: vi.fn().mockResolvedValue({ baseUrl: "https://new.example.com/v1", model: "small-model", hasApiKey: true }),
    testConnection: vi.fn().mockResolvedValue({ ok: true, message: "连接成功" }),
    setApiKey: vi.fn().mockResolvedValue(undefined),
    clearApiKey: vi.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    Object.assign(window, { mindmapAI: { settings } });
    Object.values(settings).forEach((mock) => mock.mockClear());
  });
  afterEach(() => document.body.replaceChildren());

  test("loads one compatible connection without exposing the saved key", async () => {
    render(<AiSettingsPage titleSource="automatic" onTitleSourceChange={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByDisplayValue("https://api.example.com/v1")).toBeTruthy();
    expect(screen.getByText("API 密钥已安全保存")).toBeTruthy();
    expect(screen.getByText(/单一节点.*生成标题/)).toBeTruthy();
    expect(screen.getByText(/生成子节点.*最多 12 个/)).toBeTruthy();
    expect(document.body.textContent).not.toContain("sk-");
  });

  test("validates HTTPS and confirms reuse of a key at a changed endpoint", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<AiSettingsPage titleSource="api" onTitleSourceChange={vi.fn()} onClose={vi.fn()} />);
    const baseUrl = await screen.findByLabelText("Base URL");
    fireEvent.change(baseUrl, { target: { value: "http://unsafe.example/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("必须使用 HTTPS");
    fireEvent.change(baseUrl, { target: { value: "https://new.example.com/v1" } });
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    expect(settings.updatePublicSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "保存设置" }));
    await waitFor(() => expect(settings.updatePublicSettings).toHaveBeenCalledWith(expect.any(Object), true));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });

  test("changes title source and closes through the back action", async () => {
    const onTitleSourceChange = vi.fn();
    const onClose = vi.fn();
    render(<AiSettingsPage titleSource="local" onTitleSourceChange={onTitleSourceChange} onClose={onClose} />);
    await screen.findByLabelText("Base URL");
    fireEvent.click(screen.getByRole("radio", { name: "自动（有密钥用 API）" }));
    expect(onTitleSourceChange).toHaveBeenCalledWith("automatic");
    fireEvent.click(screen.getByRole("button", { name: "返回工作区" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("applies the DeepSeek preset and tests the unsaved connection", async () => {
    render(<AiSettingsPage titleSource="api" onTitleSourceChange={vi.fn()} onClose={vi.fn()} />);
    await screen.findByLabelText("Base URL");

    fireEvent.click(screen.getByRole("button", { name: "使用 DeepSeek 配置" }));
    expect(screen.getByLabelText("Base URL")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByLabelText("模型")).toHaveValue("deepseek-chat");

    fireEvent.change(screen.getByLabelText("API 密钥"), { target: { value: "new-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    await waitFor(() => expect(settings.testConnection).toHaveBeenCalledWith({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "new-secret"
    }));
    expect(await screen.findByRole("status")).toHaveTextContent("连接成功");
  });
});
