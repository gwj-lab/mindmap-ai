import { z } from "zod";
import type { PanelBounds } from "./types.js";

export type NavigationClass = "internal" | "oauth" | "external" | "blocked";

const INTERNAL_HOSTS = new Set(["chatgpt.com", "openai.com", "auth.openai.com", "yuanbao.tencent.com", "www.doubao.com"]);
const OAUTH_HOSTS = new Set([
  "accounts.google.com",
  "login.microsoftonline.com",
  "appleid.apple.com"
]);

export function classifyNavigation(rawUrl: string): NavigationClass {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "blocked";
  }
  if (url.protocol !== "https:") return "blocked";
  if (INTERNAL_HOSTS.has(url.hostname) || url.hostname.endsWith(".openai.com")) return "internal";
  if (OAUTH_HOSTS.has(url.hostname)) return "oauth";
  return "external";
}

const panelBoundsSchema = z.object({
  x: z.number().finite().int().min(-10000).max(10000),
  y: z.number().finite().int().min(-10000).max(10000),
  width: z.number().finite().int().min(0).max(20000),
  height: z.number().finite().int().min(0).max(20000)
});

export function validatePanelBounds(bounds: PanelBounds): PanelBounds {
  return panelBoundsSchema.parse(bounds);
}
