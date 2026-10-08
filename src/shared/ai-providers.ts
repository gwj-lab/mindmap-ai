import type { ProviderId } from "./types.js";

export const AI_PROVIDERS: Record<ProviderId, { name: string; url: string }> = {
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/" },
  yuanbao: { name: "腾讯元宝", url: "https://yuanbao.tencent.com/" },
  doubao: { name: "豆包", url: "https://www.doubao.com/chat/" }
};

export function isProviderId(value: unknown): value is ProviderId {
  return value === "chatgpt" || value === "yuanbao" || value === "doubao";
}
