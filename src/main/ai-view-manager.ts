import { BrowserWindow, dialog, shell, WebContentsView } from "electron";
import { classifyNavigation } from "../shared/security.js";
import { AI_PROVIDERS } from "../shared/ai-providers.js";
import type { AiTab, PanelBounds } from "../shared/types.js";

interface ManagedTab extends AiTab {
  view: WebContentsView;
  visible: boolean;
  bounds: PanelBounds | null;
  hoverCaptureEnabled: boolean;
  expansionPrompt: string;
}

export class AiViewManager {
  readonly #tabs = new Map<string, ManagedTab>();
  #visible = true;
  #dragging = false;

  constructor(
    private readonly owner: BrowserWindow,
    private readonly preloadPath: string,
    private readonly onError: (message: string) => void
  ) {
    this.syncTabs([{ id: "ai", provider: "chatgpt" }]);
  }

  syncTabs(tabs: AiTab[]): void {
    const wanted = new Map(tabs.map((tab) => [tab.id, tab.provider]));
    for (const tab of this.#tabs.values()) {
      if (wanted.get(tab.id) !== tab.provider) this.#closeTab(tab);
    }
    for (const tab of tabs) {
      if (!this.#tabs.has(tab.id)) this.#createTab(tab);
    }
  }

  #createTab(descriptor: AiTab): void {
    const view = new WebContentsView({
      webPreferences: {
        preload: this.preloadPath,
        partition: `persist:provider-${descriptor.provider}`,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    this.owner.contentView.addChildView(view);
    view.setBackgroundColor("#f7f8f9");
    const tab: ManagedTab = {
      ...descriptor, view, visible: false, bounds: null, hoverCaptureEnabled: true, expansionPrompt: ""
    };
    this.#tabs.set(tab.id, tab);
    view.setVisible(false);
    this.#configureSecurity(view);
    view.webContents.on("did-finish-load", () => this.#sendHoverCaptureState(tab));
    void view.webContents.loadURL(AI_PROVIDERS[tab.provider].url).catch(() => {
      if (this.#tabs.get(tab.id) === tab && !view.webContents.isDestroyed()) {
        this.onError(`${AI_PROVIDERS[tab.provider].name} 加载失败，请检查网络后重新打开标签页`);
      }
    });
  }

  setBounds(bounds: PanelBounds, tabId = "ai"): void {
    const tab = this.#tabs.get(tabId);
    if (!tab) return;
    if (tab.bounds && Object.entries(bounds).every(([key, value]) => tab.bounds?.[key as keyof PanelBounds] === value)) return;
    tab.bounds = { ...bounds };
    tab.view.setBounds(bounds);
  }

  setVisible(visible: boolean, tabId?: string): void {
    if (tabId !== undefined) {
      const tab = this.#tabs.get(tabId);
      if (!tab) return;
      tab.visible = visible;
      this.#updateVisibility(tab);
    } else {
      this.#visible = visible;
      for (const tab of this.#tabs.values()) this.#updateVisibility(tab);
    }
  }

  setDragging(dragging: boolean): void {
    this.#dragging = dragging;
    for (const tab of this.#tabs.values()) this.#updateVisibility(tab);
  }

  #updateVisibility(tab: ManagedTab): void {
    tab.view.setVisible(this.#visible && tab.visible && !this.#dragging);
  }

  requestCapture(tabId = "ai"): void {
    this.#tabs.get(tabId)?.view.webContents.send("ai:capture-latest");
  }

  requestPicker(tabId = "ai"): void {
    this.#tabs.get(tabId)?.view.webContents.send("ai:pick-answer");
  }

  setHoverCapture(enabled: boolean, tabId = "ai"): void {
    const tab = this.#tabs.get(tabId);
    if (!tab) return;
    tab.hoverCaptureEnabled = enabled;
    this.#sendHoverCaptureState(tab);
  }

  setExpansionPrompt(prompt: string, tabId = "ai"): void {
    const tab = this.#tabs.get(tabId);
    if (tab) tab.expansionPrompt = prompt;
  }

  getCaptureContext(sender: Electron.WebContents): { provider: AiTab["provider"]; expansionPrompt: string } | null {
    for (const tab of this.#tabs.values()) {
      if (tab.view.webContents === sender) return { provider: tab.provider, expansionPrompt: tab.expansionPrompt };
    }
    return null;
  }

  getTabId(sender: Electron.WebContents): string | null {
    for (const tab of this.#tabs.values()) if (tab.view.webContents === sender) return tab.id;
    return null;
  }

  startConcept(tabId: string, id: string, prompt: string): void {
    const tab = this.#tabs.get(tabId);
    if (!tab) throw new Error("生成标签页不存在");
    const send = (): void => { if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send("concepts:generate", { id, provider: tab.provider, prompt }); };
    if (tab.view.webContents.isLoading()) tab.view.webContents.once("did-finish-load", send); else send();
  }

  broadcastConcepts(marks: unknown): void {
    for (const tab of this.#tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send("concepts:marks", marks);
  }

  #sendHoverCaptureState(tab: ManagedTab): void {
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.send("ai:set-hover-capture", tab.hoverCaptureEnabled);
  }

  #closeTab(tab: ManagedTab): void {
    this.#tabs.delete(tab.id);
    if (!this.owner.isDestroyed()) this.owner.contentView.removeChildView(tab.view);
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  }

  destroy(): void {
    for (const tab of this.#tabs.values()) this.#closeTab(tab);
  }

  #configureSecurity(view: WebContentsView): void {
    const session = view.webContents.session;
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    view.webContents.on("will-navigate", (event, url) => {
      const classification = classifyNavigation(url);
      if (classification === "internal" || classification === "oauth") return;
      event.preventDefault();
      if (classification === "external") void this.#confirmExternal(url);
    });

    view.webContents.setWindowOpenHandler(({ url }) => {
      const classification = classifyNavigation(url);
      if (classification === "internal" || classification === "oauth") {
        return {
          action: "allow",
          overrideBrowserWindowOptions: {
            parent: this.owner,
            autoHideMenuBar: true,
            webPreferences: {
              session,
              nodeIntegration: false,
              contextIsolation: true,
              sandbox: true,
              webSecurity: true
            }
          }
        };
      }
      if (classification === "external") void this.#confirmExternal(url);
      return { action: "deny" };
    });
  }

  async #confirmExternal(url: string): Promise<void> {
    const result = await dialog.showMessageBox(this.owner, {
      type: "question",
      buttons: ["取消", "在浏览器中打开"],
      defaultId: 0,
      cancelId: 0,
      title: "打开外部链接",
      message: "该链接将离开 Mindmap AI。",
      detail: new URL(url).hostname
    });
    if (result.response === 1) await shell.openExternal(url);
  }
}
