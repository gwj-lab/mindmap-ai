import { Actions, DockLocation, type TabSetNode } from "flexlayout-react";
import { describe, expect, test } from "vitest";
import { collectAiTabs, createLayoutModel, isAiTabSet } from "../../src/renderer/src/ai-tabs.js";

const legacyLayout = {
  global: {}, borders: [], layout: {
    type: "row", children: [{ type: "tabset", id: "chat-area", children: [
      { type: "tab", id: "ai", component: "ai", name: "ChatGPT" }
    ] }]
  }
};

describe("AI dock tabs", () => {
  test("upgrades an existing ChatGPT area and keeps its add-tab entry after closing the last tab", () => {
    const model = createLayoutModel(legacyLayout);
    expect(collectAiTabs(model)).toEqual([{ id: "ai", provider: "chatgpt" }]);
    model.doAction(Actions.deleteTab("ai"));
    const tabset = model.getNodeById("chat-area") as TabSetNode;
    expect(tabset).toBeDefined();
    expect(isAiTabSet(tabset)).toBe(true);
    model.doAction(Actions.addNode({ type: "tab", id: "yuanbao-tab", component: "ai", name: "腾讯元宝", config: { provider: "yuanbao" } }, "chat-area", DockLocation.CENTER, -1, true));
    expect(collectAiTabs(model)).toEqual([{ id: "yuanbao-tab", provider: "yuanbao" }]);
  });

  test("persists multiple providers and separate tabs for the same provider", () => {
    const model = createLayoutModel(legacyLayout);
    for (const [id, provider] of [["yuanbao-tab", "yuanbao"], ["doubao-one", "doubao"], ["doubao-two", "doubao"]]) {
      model.doAction(Actions.addNode({ type: "tab", id, component: "ai", name: provider, config: { provider } }, "chat-area", DockLocation.CENTER, -1, true));
    }
    expect(collectAiTabs(createLayoutModel(model.toJson()))).toEqual([
      { id: "ai", provider: "chatgpt" }, { id: "yuanbao-tab", provider: "yuanbao" },
      { id: "doubao-one", provider: "doubao" }, { id: "doubao-two", provider: "doubao" }
    ]);
  });
});
