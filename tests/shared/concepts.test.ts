import { describe, expect, test } from "vitest";
import { conceptPrompt, conceptSettingsSchema, DEFAULT_CONCEPT_SETTINGS, sentenceAt } from "../../src/shared/concepts.js";

describe("concept context", () => {
  test("keeps a complete sentence with decimal values and mixed punctuation", () => {
    const text = "先估计模型。残差是观测值与预测值之差，例如 0.25。下一句。";
    const start = text.indexOf("残差");
    expect(sentenceAt(text, start, start + 2)).toBe("残差是观测值与预测值之差，例如 0.25。");
    expect(sentenceAt("表格标题：残差", 5, 7)).toBe("表格标题：残差");
  });
  test("inserts context literally, without recursively replacing placeholders", () => {
    const result = conceptPrompt(DEFAULT_CONCEPT_SETTINGS, { sourceAnswerId: "answer", sourceTitle: "回归模型", selection: { text: "残差", sentence: "残差是观测值与预测值之差，{concept} 是字面文本。", prefix: "", suffix: "" } });
    expect(result).toContain("当前主题是“回归模型”");
    expect(result).toContain("残差是观测值与预测值之差，{concept} 是字面文本。");
    expect(result).toContain("这句话中“残差”的具体含义");
    expect(() => conceptSettingsSchema.parse({ ...DEFAULT_CONCEPT_SETTINGS, prompt: "{concept}是什么" })).toThrow();
  });
});
