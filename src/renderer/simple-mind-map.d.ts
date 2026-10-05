declare module "simple-mind-map" {
  interface LibraryNode {
    uid: string;
    nodeData: { data: Record<string, unknown>; children?: LibraryData[] };
    group: { node: SVGGraphicsElement };
    children: LibraryNode[];
    highlight(): void;
    closeHighlight(): void;
    getData(key: string): unknown;
  }

  interface LibraryData {
    data: Record<string, unknown>;
    children: LibraryData[];
  }

  export default class MindMap {
    constructor(options: Record<string, unknown>);
    static usePlugin(plugin: unknown): typeof MindMap;
    renderer: {
      root: LibraryNode | null;
      activeNodeList: LibraryNode[];
      textEdit?: { hideEditTextBox(): void };
    };
    keyCommand: {
      addShortcut(key: string, listener: () => void): void;
      removeShortcut(key: string, listener?: () => void): void;
    };
    view: { enlarge(): void; narrow(): void; fit(): void; reset(): void };
    on(event: string, listener: (...args: unknown[]) => void): void;
    off(event: string, listener: (...args: unknown[]) => void): void;
    execCommand(command: string, ...args: unknown[]): void;
    setData(data: LibraryData): void;
    updateData(data: LibraryData): void;
    setThemeConfig(config: Record<string, unknown>): void;
    resize(): void;
    destroy(): void;
  }
}

declare module "simple-mind-map/src/plugins/Drag.js" { const plugin: unknown; export default plugin; }
declare module "simple-mind-map/src/plugins/KeyboardNavigation.js" { const plugin: unknown; export default plugin; }
declare module "simple-mind-map/src/plugins/Select.js" { const plugin: unknown; export default plugin; }
