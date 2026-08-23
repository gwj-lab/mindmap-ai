import { describe, expect, test, vi } from "vitest";
import { TitleService } from "../../src/main/title-service.js";

const options = {
  baseUrl: "https://api.example.com/v1",
  model: "small-model",
  apiKey: "secret",
  mode: "expanded" as const
};

function compatibleResponse(content: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers }
  });
}

describe("AI title service", () => {
  test("reports a successful DeepSeek-compatible connection without returning credentials", async () => {
    const fetchFn = vi.fn().mockResolvedValue(compatibleResponse({ title: "连接成功", subtitles: [] }));
    const result = await new TitleService(fetchFn).testConnection({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "deepseek-secret"
    });

    expect(result).toEqual({ ok: true, message: "连接成功" });
    expect(fetchFn.mock.calls[0]?.[0]).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.stringify(result)).not.toContain("deepseek-secret");
  });

  test.each([
    [401, "API 密钥无效"],
    [402, "账户余额不足"],
    [404, "Base URL 或模型不存在"],
    [429, "请求过于频繁"],
    [503, "API 服务暂时不可用"]
  ])("classifies HTTP %s without exposing the provider response", async (status, message) => {
    const response = new Response(JSON.stringify({ error: { message: "secret-provider-detail" } }), { status });
    const result = await new TitleService(vi.fn().mockResolvedValue(response)).testConnection({
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      apiKey: "secret"
    });

    expect(result).toEqual({ ok: false, message });
    expect(result.message).not.toContain("secret-provider-detail");
  });

  test("calls one HTTPS OpenAI-compatible endpoint with model and bounded answer", async () => {
    const fetchFn = vi.fn().mockResolvedValue(compatibleResponse({ title: "API title", subtitles: ["One", "Two"] }));
    const service = new TitleService(fetchFn);
    await expect(service.extract("# Local\nBody", options)).resolves.toEqual({ title: "API title", subtitles: ["One", "Two"] });

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/v1/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "small-model" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
  });

  test("rejects insecure Base URLs without making a request and falls back locally", async () => {
    const fetchFn = vi.fn();
    const service = new TitleService(fetchFn);
    await expect(service.extract("# Local title\n- Child", { ...options, baseUrl: "http://example.com/v1" }))
      .resolves.toEqual({ title: "Local title", subtitles: ["Child"] });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("aborts on timeout and does not retry a chargeable request", async () => {
    const fetchFn = vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const service = new TitleService(fetchFn, { timeoutMs: 5 });
    await expect(service.extract("# Local title", options)).resolves.toEqual({ title: "Local title", subtitles: [] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test("caps API subtitles at 12 and normalizes duplicates", async () => {
    const subtitles = Array.from({ length: 16 }, (_, index) => `Child ${index + 1}`);
    const service = new TitleService(vi.fn().mockResolvedValue(compatibleResponse({ title: "API title", subtitles: [...subtitles, "Child 1"] })));
    const result = await service.extract("Local", options);
    expect(result.subtitles).toHaveLength(12);
    expect(result.subtitles.at(-1)).toBe("Child 12");
  });

  test("falls back for oversized, malformed, and empty responses without retry", async () => {
    const oversized = vi.fn().mockResolvedValue(compatibleResponse({ title: "ignored", subtitles: [] }, { "content-length": "2000000" }));
    await expect(new TitleService(oversized).extract("# Local", options)).resolves.toEqual({ title: "Local", subtitles: [] });
    expect(oversized).toHaveBeenCalledTimes(1);

    const malformed = vi.fn().mockResolvedValue(new Response("not json", { status: 200 }));
    await expect(new TitleService(malformed).extract("# Local", options)).resolves.toEqual({ title: "Local", subtitles: [] });
    expect(malformed).toHaveBeenCalledTimes(1);

    const empty = vi.fn().mockResolvedValue(compatibleResponse({ title: "", subtitles: [] }));
    await expect(new TitleService(empty).extract("# Local", options)).resolves.toEqual({ title: "Local", subtitles: [] });
    expect(empty).toHaveBeenCalledTimes(1);
  });

  test("explains when a real API attempt falls back to local extraction", async () => {
    const service = new TitleService(vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    await expect(service.extractWithStatus("# Local title", options)).resolves.toEqual({
      title: "Local title",
      subtitles: [],
      apiWarning: "API 密钥无效，已使用本地规则"
    });
  });
});
