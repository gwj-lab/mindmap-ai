import { describe, expect, test } from "vitest";
import { classifyNavigation, validatePanelBounds } from "../../src/shared/security.js";

describe("remote content security", () => {
  test("keeps trusted ChatGPT and OAuth hosts inside the sandbox", () => {
    expect(classifyNavigation("https://chatgpt.com/c/123")).toBe("internal");
    expect(classifyNavigation("https://auth.openai.com/authorize")).toBe("internal");
    expect(classifyNavigation("https://yuanbao.tencent.com/chat/123")).toBe("internal");
    expect(classifyNavigation("https://www.doubao.com/chat/123")).toBe("internal");
    expect(classifyNavigation("https://accounts.google.com/o/oauth2/v2/auth")).toBe("oauth");
  });

  test("rejects cleartext, local, and script navigation", () => {
    expect(classifyNavigation("http://chatgpt.com")).toBe("blocked");
    expect(classifyNavigation("file:///C:/Windows/win.ini")).toBe("blocked");
    expect(classifyNavigation("javascript:alert(1)")).toBe("blocked");
    expect(classifyNavigation("https://example.com")).toBe("external");
  });

  test("accepts only finite on-screen panel rectangles", () => {
    expect(validatePanelBounds({ x: 10, y: 20, width: 800, height: 600 })).toEqual({
      x: 10,
      y: 20,
      width: 800,
      height: 600
    });
    expect(() => validatePanelBounds({ x: 0, y: 0, width: -1, height: 10 })).toThrow();
    expect(() => validatePanelBounds({ x: Number.NaN, y: 0, width: 10, height: 10 })).toThrow();
  });
});
