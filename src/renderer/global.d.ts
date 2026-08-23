import type { DesktopApi } from "../shared/types.js";

declare global {
  interface Window {
    mindmapAI: DesktopApi;
  }
}

export {};
