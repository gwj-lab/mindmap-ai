import { BrowserWindow, dialog, shell, WebContentsView } from "electron";
import { classifyNavigation } from "../shared/security.js";
import type { PanelBounds } from "../shared/types.js";

export class AiViewManager {
  readonly view: WebContentsView;
  #visible = true;
  #dragging = false;
  #hoverCaptureEnabled = true;

  constructor(private readonly owner: BrowserWindow, preloadPath: string) {
    this.view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        partition: "persist:provider-chatgpt",
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    owner.contentView.addChildView(this.view);
    this.view.setBackgroundColor("#f7f8f9");
    this.#configureSecurity();
    this.view.webContents.on("did-finish-load", () => this.#sendHoverCaptureState());
  }

  async load(): Promise<void> {
    await this.view.webContents.loadURL("https://chatgpt.com/");
  }

  setBounds(bounds: PanelBounds): void {
    this.view.setBounds(bounds);
  }

  setVisible(visible: boolean): void {
    this.#visible = visible;
    this.view.setVisible(visible && !this.#dragging);
  }

  setDragging(dragging: boolean): void {
    this.#dragging = dragging;
    this.view.setVisible(this.#visible && !dragging);
  }

  requestCapture(): void {
    this.view.webContents.send("ai:capture-latest");
  }

  requestPicker(): void {
    this.view.webContents.send("ai:pick-answer");
  }

  setHoverCapture(enabled: boolean): void {
    this.#hoverCaptureEnabled = enabled;
    this.#sendHoverCaptureState();
  }

  #sendHoverCaptureState(): void {
    if (!this.view.webContents.isDestroyed()) {
      this.view.webContents.send("ai:set-hover-capture", this.#hoverCaptureEnabled);
    }
  }

  destroy(): void {
    if (!this.owner.isDestroyed()) this.owner.contentView.removeChildView(this.view);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }

  #configureSecurity(): void {
    const session = this.view.webContents.session;
    session.setPermissionCheckHandler(() => false);
    session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

    this.view.webContents.on("will-navigate", (event, url) => {
      const classification = classifyNavigation(url);
      if (classification === "internal" || classification === "oauth") return;
      event.preventDefault();
      if (classification === "external") void this.#confirmExternal(url);
    });

    this.view.webContents.setWindowOpenHandler(({ url }) => {
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
