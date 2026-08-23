import { z } from "zod";
import { extractExpandedTitles, extractSingleTitle } from "../shared/title-extraction.js";
import type { AiConnectionTestResult } from "../shared/types.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface TitleExtractionOptions {
  baseUrl: string;
  model: string;
  apiKey: string;
  mode: "single" | "expanded";
}

export type TitleConnectionOptions = Omit<TitleExtractionOptions, "mode">;
export interface TitleExtractionResult { title: string; subtitles: string[]; apiWarning?: string }
type ExtractionAttempt =
  | { ok: true; value: { title: string; subtitles: string[] } }
  | { ok: false; message: string };

interface TitleServiceLimits {
  timeoutMs?: number;
  maxInputBytes?: number;
  maxResponseBytes?: number;
}

const extractionSchema = z.object({
  title: z.string().trim().min(1).max(500),
  subtitles: z.array(z.string().trim().min(1).max(500)).max(100).default([])
}).strict();

const compatibleResponseSchema = z.object({
  choices: z.array(z.object({
    message: z.object({ content: z.string() })
  })).min(1)
});

function localFallback(markdown: string, mode: "single" | "expanded"): { title: string; subtitles: string[] } {
  return mode === "expanded"
    ? extractExpandedTitles(markdown)
    : { title: extractSingleTitle(markdown), subtitles: [] };
}

function endpointFromBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl.trim());
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Only credential-free HTTPS API URLs are allowed");
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/$/, "");
  url.pathname = path.endsWith("/chat/completions") ? path : `${path}/chat/completions`;
  return url.href;
}

function truncateUtf8(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value);
  if (bytes.byteLength <= maxBytes) return value;
  return bytes.subarray(0, maxBytes).toString("utf8").replace(/\uFFFD$/, "");
}

function parseModelContent(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(trimmed);
}

function messageForStatus(status: number): string {
  if (status === 401) return "API 密钥无效";
  if (status === 402) return "账户余额不足";
  if (status === 403) return "API 拒绝访问";
  if (status === 404) return "Base URL 或模型不存在";
  if (status === 429) return "请求过于频繁";
  if (status >= 500) return "API 服务暂时不可用";
  return "API 请求参数或模型不兼容";
}

export class TitleService {
  readonly #timeoutMs: number;
  readonly #maxInputBytes: number;
  readonly #maxResponseBytes: number;

  constructor(private readonly fetchFn: FetchLike, limits: TitleServiceLimits = {}) {
    this.#timeoutMs = limits.timeoutMs ?? 12_000;
    this.#maxInputBytes = limits.maxInputBytes ?? 120_000;
    this.#maxResponseBytes = limits.maxResponseBytes ?? 1_000_000;
  }

  async testConnection(options: TitleConnectionOptions): Promise<AiConnectionTestResult> {
    let endpoint: string;
    try {
      endpoint = endpointFromBaseUrl(options.baseUrl);
    } catch {
      return { ok: false, message: "Base URL 必须是无凭据的 HTTPS 地址" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: "Return strict JSON: {\"title\":\"连接成功\",\"subtitles\":[]}." },
            { role: "user", content: "连接测试" }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) return { ok: false, message: messageForStatus(response.status) };
      const announcedSize = Number(response.headers.get("content-length") ?? 0);
      if (announcedSize > this.#maxResponseBytes) return { ok: false, message: "API 响应过大" };
      const responseText = await response.text();
      if (Buffer.byteLength(responseText) > this.#maxResponseBytes) return { ok: false, message: "API 响应过大" };
      const envelope = compatibleResponseSchema.parse(JSON.parse(responseText));
      extractionSchema.parse(parseModelContent(envelope.choices[0]!.message.content));
      return { ok: true, message: "连接成功" };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof DOMException && error.name === "AbortError"
          ? "API 连接超时"
          : "API 响应格式无效或网络连接失败"
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async extract(markdown: string, options: TitleExtractionOptions): Promise<{ title: string; subtitles: string[] }> {
    const fallback = localFallback(markdown, options.mode);
    const attempt = await this.#extractFromApi(markdown, options);
    return attempt.ok ? attempt.value : fallback;
  }

  async extractWithStatus(markdown: string, options: TitleExtractionOptions): Promise<TitleExtractionResult> {
    const fallback = localFallback(markdown, options.mode);
    const attempt = await this.#extractFromApi(markdown, options);
    return attempt.ok
      ? attempt.value
      : { ...fallback, apiWarning: `${attempt.message}，已使用本地规则` };
  }

  async #extractFromApi(markdown: string, options: TitleExtractionOptions): Promise<ExtractionAttempt> {
    let endpoint: string;
    try {
      endpoint = endpointFromBaseUrl(options.baseUrl);
    } catch {
      return { ok: false, message: "Base URL 必须是无凭据的 HTTPS 地址" };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      const requestedShape = options.mode === "expanded"
        ? "Return a concise title and up to 12 ordered subtitle nodes."
        : "Return one concise title and an empty subtitles array.";
      const response = await this.fetchFn(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`
        },
        body: JSON.stringify({
          model: options.model,
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: `${requestedShape} Respond as strict JSON: {"title":string,"subtitles":string[]}.` },
            { role: "user", content: truncateUtf8(markdown, this.#maxInputBytes) }
          ]
        }),
        signal: controller.signal
      });
      if (!response.ok) return { ok: false, message: messageForStatus(response.status) };
      const announcedSize = Number(response.headers.get("content-length") ?? 0);
      if (announcedSize > this.#maxResponseBytes) return { ok: false, message: "API 响应过大" };
      const responseText = await response.text();
      if (Buffer.byteLength(responseText) > this.#maxResponseBytes) return { ok: false, message: "API 响应过大" };
      const envelope = compatibleResponseSchema.parse(JSON.parse(responseText));
      const extracted = extractionSchema.parse(parseModelContent(envelope.choices[0]!.message.content));
      const title = extractSingleTitle(extracted.title);
      const seen = new Set([title.toLocaleLowerCase()]);
      const subtitles: string[] = [];
      if (options.mode === "expanded") {
        for (const rawSubtitle of extracted.subtitles) {
          const subtitle = extractSingleTitle(rawSubtitle);
          const key = subtitle.toLocaleLowerCase();
          if (subtitle === "未命名回答" || seen.has(key)) continue;
          seen.add(key);
          subtitles.push(subtitle);
          if (subtitles.length === 12) break;
        }
      }
      return { ok: true, value: { title, subtitles } };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof DOMException && error.name === "AbortError"
          ? "API 连接超时"
          : "API 响应格式无效或网络连接失败"
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
