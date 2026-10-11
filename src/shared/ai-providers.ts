import type { ProviderId } from "./types.js";

export const AI_PROVIDERS: Record<ProviderId, { name: string; url: string }> = {
  chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/" },
  yuanbao: { name: "腾讯元宝", url: "https://yuanbao.tencent.com/" },
  doubao: { name: "豆包", url: "https://www.doubao.com/chat/" },
  deepseek: { name: "DeepSeek", url: "https://chat.deepseek.com/" },
  kimi: { name: "Kimi", url: "https://www.kimi.com/" }
};

export function isProviderId(value: unknown): value is ProviderId {
  return typeof value === "string" && Object.hasOwn(AI_PROVIDERS, value);
}

export const PROVIDER_IDS = ["chatgpt", "yuanbao", "doubao", "deepseek", "kimi"] as const;
export const PROVIDER_HOSTS: Record<ProviderId, readonly string[]> = {
  chatgpt: ["chatgpt.com"], yuanbao: ["yuanbao.tencent.com"], doubao: ["www.doubao.com"],
  deepseek: ["chat.deepseek.com"], kimi: ["www.kimi.com", "kimi.com", "kimi.moonshot.cn"]
};

export function providerForUrl(sourceUrl: string): ProviderId {
  const url = new URL(sourceUrl);
  const provider = PROVIDER_IDS.find((id) => url.protocol === "https:" && PROVIDER_HOSTS[id].includes(url.hostname));
  if (!provider) throw new Error("不支持的问答网站");
  return provider;
}
