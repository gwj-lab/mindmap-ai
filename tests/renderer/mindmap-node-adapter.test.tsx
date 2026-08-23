import { describe, expect, test } from "vitest";
import {
  CONTENT_INDICATOR_NOTE,
  fromMindMapLibraryNode,
  toMindMapLibraryNode
} from "../../src/renderer/src/components/mindmap-node-adapter.js";

describe("mind-map node adapter", () => {
  test("adds a content indicator only to answer-linked nodes", () => {
    const linked = toMindMapLibraryNode({ uid: "linked", text: "回答", answerId: "answer-1", children: [] });
    const label = toMindMapLibraryNode({ uid: "label", text: "子方案", children: [] });
    expect(linked.data.note).toBe(CONTENT_INDICATOR_NOTE);
    expect(label.data.note).toBeUndefined();
  });

  test("keeps expanded children title-only", () => {
    const converted = toMindMapLibraryNode({
      uid: "root",
      text: "回答",
      answerId: "answer-1",
      children: [{ uid: "child", text: "子方案", children: [] }]
    });
    expect(converted.data.note).toBe(CONTENT_INDICATOR_NOTE);
    expect(converted.children[0]?.data.note).toBeUndefined();
  });

  test("removes the derived note during round-trip conversion", () => {
    const source = { uid: "linked", text: "回答", answerId: "answer-1", children: [] };
    const roundTrip = fromMindMapLibraryNode(toMindMapLibraryNode(source));
    expect(roundTrip).toEqual(source);
    expect(roundTrip).not.toHaveProperty("note");
  });
});
