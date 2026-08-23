import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  parsePortableMap,
  rewriteProjectLinksForExport,
  serializePortableMap,
  serializeTrayIndex
} from "../../src/shared/portable-map.js";
import type { CandidateNode, MindMapNodeData } from "../../src/shared/types.js";

const PROJECT = {
  projectId: "2cb66115-270c-4107-89e0-f61508c14d2b",
  name: "可移植研究"
};

const TREE: MindMapNodeData = {
  uid: "root",
  text: "中心主题",
  children: [
    {
      uid: "answer-node",
      text: "回答 [一]",
      answerId: "answer-1",
      children: [{ uid: "detail", text: "公式与代码", children: [] }]
    },
    { uid: "plain", text: "普通节点", children: [] }
  ]
};

describe("portable map format", () => {
  test("serializes a linked tree deterministically", async () => {
    const expected = await readFile(
      fileURLToPath(new URL("../fixtures/portable-map/linked-tree.md", import.meta.url)),
      "utf8"
    );
    const first = serializePortableMap(PROJECT, TREE);
    expect(first).toBe(expected);
    expect(serializePortableMap(PROJECT, TREE)).toBe(first);
    expect(first).toContain("[回答 \\[一\\]](../../answers/answer-1.md)");
    expect(first).toContain("```mermaid\nmindmap");
  });

  test("round trips exact titles including punctuation and newlines", async () => {
    const specialTree: MindMapNodeData = {
      uid: "special-root",
      text: "引号 \"、括号 [x] 与 -- 注释",
      children: [{
        uid: "special-child",
        text: "第一行\n第二行 `code`",
        answerId: "safe_answer-2",
        children: []
      }]
    };
    const expected = await readFile(
      fileURLToPath(new URL("../fixtures/portable-map/special-characters.md", import.meta.url)),
      "utf8"
    );
    const markdown = serializePortableMap({ ...PROJECT, name: "特殊字符" }, specialTree);
    expect(markdown).toBe(expected);
    expect(parsePortableMap(markdown)).toEqual(specialTree);
  });

  test("recovers from the outline when the Mermaid block is removed", () => {
    const markdown = serializePortableMap(PROJECT, TREE);
    const withoutMermaid = markdown.replace(/\n## Mermaid[\s\S]*$/, "\n");
    expect(parsePortableMap(withoutMermaid)).toEqual(TREE);
  });

  test("rejects duplicate node ids and unsafe answer links", () => {
    const duplicate = serializePortableMap(PROJECT, {
      uid: "same",
      text: "Root",
      children: [{ uid: "same", text: "Child", children: [] }]
    });
    expect(() => parsePortableMap(duplicate)).toThrow(/Duplicate node uid/);

    const unsafe = serializePortableMap(PROJECT, TREE).replace(
      "../../answers/answer-1.md",
      "../../answers/../secret.md"
    );
    expect(() => parsePortableMap(unsafe)).toThrow(/Unsafe answer link/);
  });

  test("rewrites only validated answer links for a standalone export", () => {
    const markdown = `${serializePortableMap(PROJECT, TREE)}\n[Other](../../answers/../bad.md)\n`;
    const rewritten = rewriteProjectLinksForExport(markdown);
    expect(rewritten).toContain("(answers/answer-1.md)");
    expect(rewritten).toContain("(../../answers/../bad.md)");
  });

  test("writes a readable deterministic tray index", () => {
    const entries: CandidateNode[] = [{
      id: "candidate-1",
      answerId: "answer-1",
      title: "候选标题",
      extractionMode: "expanded",
      children: [{ id: "child-1", title: "子标题" }],
      createdAt: "2026-08-18T00:00:00.000Z"
    }];
    expect(serializeTrayIndex("Candidates", entries)).toBe(
      "# Candidates\n\n- [候选标题](../../answers/answer-1.md)\n  - 子标题\n"
    );
  });
});
