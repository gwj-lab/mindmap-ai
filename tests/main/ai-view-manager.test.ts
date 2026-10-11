import type { BrowserWindow } from "electron";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { AiViewManager } from "../../src/main/ai-view-manager.js";

interface MockView {
  options: { webPreferences: { partition: string } };
  webContents: {
    send: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    isDestroyed(): boolean;
  };
  setVisible: ReturnType<typeof vi.fn>;
}

const harness = vi.hoisted(() => ({ views: [] as MockView[] }));
vi.mock("electron", () => ({
  WebContentsView: class {
    destroyed = false;
    webContents = {
      session: { setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn() },
      on: vi.fn(), setWindowOpenHandler: vi.fn(), send: vi.fn(), loadURL: vi.fn().mockResolvedValue(undefined),
      isLoading: () => false,
      isDestroyed: () => this.destroyed, close: vi.fn(() => { this.destroyed = true; })
    };
    setBackgroundColor = vi.fn();
    setBounds = vi.fn();
    setVisible = vi.fn();
    constructor(public options: { webPreferences: { partition: string } }) { harness.views.push(this); }
  },
  dialog: { showMessageBox: vi.fn() }, shell: { openExternal: vi.fn() }
}));

function createManager(): AiViewManager {
  const owner = { contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, isDestroyed: () => false };
  return new AiViewManager(owner as unknown as BrowserWindow, "chat.cjs", vi.fn());
}

describe("AI tab views", () => {
  beforeEach(() => { harness.views.length = 0; });

  test("retains existing pages, isolates provider sessions and closes removed tabs", () => {
    const manager = createManager();
    const tabs = [{ id: "ai", provider: "chatgpt" }, { id: "yuanbao-tab", provider: "yuanbao" }, { id: "doubao-tab", provider: "doubao" }] as const;
    manager.syncTabs([...tabs]);
    const [chatgpt, yuanbao, doubao] = harness.views;
    manager.syncTabs([...tabs]);
    expect(harness.views).toHaveLength(3);
    expect(chatgpt.webContents.loadURL).toHaveBeenCalledTimes(1);
    expect(yuanbao.options.webPreferences.partition).toBe("persist:provider-yuanbao");
    expect(doubao.options.webPreferences.partition).toBe("persist:provider-doubao");
    manager.syncTabs([tabs[0], tabs[2]]);
    expect(yuanbao.webContents.close).toHaveBeenCalledTimes(1);
    expect(chatgpt.webContents.isDestroyed()).toBe(false);
    manager.destroy();
    expect(chatgpt.webContents.close).toHaveBeenCalledTimes(1);
    expect(doubao.webContents.close).toHaveBeenCalledTimes(1);
  });

  test("routes capture and expansion settings to the intended tab and hides every page during local drag", () => {
    const manager = createManager();
    manager.syncTabs([{ id: "ai", provider: "chatgpt" }, { id: "doubao-tab", provider: "doubao" }]);
    const [chatgpt, doubao] = harness.views;
    manager.setVisible(true, "ai");
    manager.setVisible(true, "doubao-tab");
    manager.setExpansionPrompt("Compare", "doubao-tab", "expanded");
    manager.requestCapture("doubao-tab");
    expect(doubao.webContents.send).toHaveBeenCalledWith("ai:capture-latest");
    expect(chatgpt.webContents.send).not.toHaveBeenCalled();
    expect(manager.getCaptureContext(doubao.webContents as unknown as Electron.WebContents)).toEqual({ provider: "doubao", expansionPrompt: "Compare", captureMode: "expanded" });
    expect(manager.getCaptureContext(chatgpt.webContents as unknown as Electron.WebContents)?.expansionPrompt).toBe("");
    expect(manager.getCaptureContext({} as Electron.WebContents)).toBeNull();
    manager.setDragging(true);
    expect(chatgpt.setVisible).toHaveBeenLastCalledWith(false);
    expect(doubao.setVisible).toHaveBeenLastCalledWith(false);
    manager.setVisible(false, "ai");
    manager.setDragging(false);
    expect(chatgpt.setVisible).toHaveBeenLastCalledWith(false);
    expect(doubao.setVisible).toHaveBeenLastCalledWith(true);
    manager.destroy();
  });

  test("background concepts survive visible-tab sync and close without touching the source page", () => {
    const manager = createManager();
    manager.startBackgroundConcept({ id: "concept-background", provider: "doubao" }, "concept-id", "完整句子");
    const [source, background] = harness.views;
    expect(background.setVisible).toHaveBeenLastCalledWith(false);
    expect(background.webContents.send).toHaveBeenCalledWith("concepts:generate", { id: "concept-id", provider: "doubao", prompt: "完整句子" });
    manager.syncTabs([{ id: "ai", provider: "chatgpt" }]);
    expect(background.webContents.isDestroyed()).toBe(false);
    manager.closeBackgroundConcept("concept-background");
    expect(background.webContents.isDestroyed()).toBe(true);
    expect(source.webContents.isDestroyed()).toBe(false);
    manager.destroy();
  });
});
