# Marquee Multiselect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add left-button marquee selection for multiple mind-map nodes and make copy, cut, paste, and safe batch deletion operate on that selection.

**Architecture:** Reuse the installed `simple-mind-map` Select plugin for rectangle drawing, overlap detection, Ctrl selection, and auto-scroll. Add one pure project-state operation for parent-aware batch trashing, then adapt `MindMapPanel` so Delete/Backspace and the toolbar submit the complete active-node UID list while single-node context actions remain single-node operations.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Vitest 4, Playwright 1.62, simple-mind-map 0.14 Select plugin.

## Global Constraints

- Marquee starts with a left-button drag on blank canvas after the plugin's 10-pixel threshold.
- Right-button and middle-button drag pan the canvas; a right-click on a node still opens its context menu.
- Ctrl+click adds or removes individual nodes from the active selection.
- Copy, cut, and paste continue through `simple-mind-map`; do not add a second clipboard implementation.
- Batch deletion moves only top-level selected subtrees to the project trash and never deletes the root.
- Read-only projects do not create a marquee or mutate the map.
- Do not persist selection state or add new dependencies.
- Do not add batch reparent dragging or batch style editing.

---

### Task 1: Parent-aware batch trash transaction

**Files:**
- Modify: `src/renderer/state/project-state.ts`
- Modify: `tests/renderer/project-state.test.ts`

**Interfaces:**
- Consumes: `trashPortableSubtree(snapshot, nodeUid, trashId?, deletedAt?)`.
- Produces: `trashPortableSubtrees(snapshot, nodeUids, options?): ActiveProjectSnapshot`, where `options` is `{ trashIds?: readonly string[]; deletedAt?: string }`.

- [ ] **Step 1: Write failing batch-trash tests**

Add `trashPortableSubtrees` to the test import and add a fixture with two sibling branches, one nested leaf, and answer links:

```ts
test("trashes selected sibling subtrees in one state transition", () => {
  const withSibling: ActiveProjectSnapshot = {
    ...portableSnapshot,
    mindmap: {
      ...portableSnapshot.mindmap,
      children: [
        ...portableSnapshot.mindmap.children,
        { uid: "branch-2", text: "Branch 2", answerId: "answer-2", children: [] }
      ]
    }
  };
  const deleted = trashPortableSubtrees(withSibling, ["branch", "branch-2"], {
    trashIds: ["trash-branch", "trash-branch-2"],
    deletedAt: "2026-08-18T02:00:00.000Z"
  });

  expect(deleted.mindmap.children).toEqual([]);
  expect(deleted.state.trash.map((entry) => entry.id)).toEqual(["trash-branch", "trash-branch-2"]);
  expect(deleted.state.trash.map((entry) => entry.kind === "subtree" ? entry.subtree.answerId : null)).toEqual([
    "answer-branch",
    "answer-2"
  ]);
});

test("coalesces selected descendants and protects the root", () => {
  const deleted = trashPortableSubtrees(portableSnapshot, ["root", "leaf", "branch", "missing", "branch"], {
    trashIds: ["trash-branch"],
    deletedAt: "2026-08-18T02:00:00.000Z"
  });

  expect(deleted.mindmap.uid).toBe("root");
  expect(deleted.mindmap.children).toEqual([]);
  expect(deleted.state.trash).toHaveLength(1);
  expect(deleted.state.trash[0]).toMatchObject({
    kind: "subtree",
    id: "trash-branch",
    subtree: { uid: "branch", children: [{ uid: "leaf", answerId: "answer-leaf" }] }
  });
});
```

- [ ] **Step 2: Run the state test and verify RED**

Run: `pnpm exec vitest run tests/renderer/project-state.test.ts`

Expected: FAIL because `trashPortableSubtrees` is not exported.

- [ ] **Step 3: Implement top-level selection normalization**

Add the pure traversal beside `trashPortableSubtree`:

```ts
interface BatchTrashOptions {
  trashIds?: readonly string[];
  deletedAt?: string;
}

function topLevelSelectedUids(root: MindMapNodeData, selectedUids: ReadonlySet<string>): string[] {
  const result: string[] = [];
  const visit = (node: MindMapNodeData, selectedAncestor: boolean): void => {
    const selected = node.uid !== root.uid && selectedUids.has(node.uid);
    if (selected && !selectedAncestor) result.push(node.uid);
    for (const child of node.children) visit(child, selectedAncestor || selected);
  };
  visit(root, false);
  return result;
}

export function trashPortableSubtrees(
  snapshot: ActiveProjectSnapshot,
  nodeUids: readonly string[],
  options: BatchTrashOptions = {}
): ActiveProjectSnapshot {
  const selected = topLevelSelectedUids(snapshot.mindmap, new Set(nodeUids));
  const deletedAt = options.deletedAt ?? new Date().toISOString();
  return selected.reduce(
    (current, uid, index) => trashPortableSubtree(
      current,
      uid,
      options.trashIds?.[index] ?? crypto.randomUUID(),
      deletedAt
    ),
    snapshot
  );
}
```

- [ ] **Step 4: Run focused state tests and verify GREEN**

Run: `pnpm exec vitest run tests/renderer/project-state.test.ts`

Expected: PASS, including sibling deletion, ancestor coalescing, root protection, missing UID handling, answer-link preservation, and existing single-trash restoration.

- [ ] **Step 5: Commit the batch state transaction**

```bash
git add src/renderer/state/project-state.ts tests/renderer/project-state.test.ts
git commit -m "feat: trash multiple selected subtrees safely"
```

### Task 2: Left-button marquee and complete-selection delete commands

**Files:**
- Modify: `src/renderer/src/components/MindMapPanel.tsx`
- Modify: `src/renderer/src/App.tsx`
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: `trashPortableSubtrees(snapshot, nodeUids)` from Task 1 and `mindMap.renderer.activeNodeList` from `simple-mind-map`.
- Changes `MindMapPanelProps` from `onDeleteNode(nodeUid: string): void` to `onDeleteNodes(nodeUids: string[]): void`.

- [ ] **Step 1: Extend the Electron workflow with failing marquee behavior**

In the existing docked-workspace E2E test, keep Child A and Sibling B instead of deleting Sibling B immediately. Clear the current selection and verify right-button pan does not select nodes:

```ts
const canvasBounds = await map.boundingBox();
if (!canvasBounds) throw new Error("Expected the map canvas to have bounds");
const blankX = canvasBounds.x + canvasBounds.width - 24;
const blankY = canvasBounds.y + canvasBounds.height - 24;
await page.mouse.click(blankX, blankY);
await page.mouse.move(blankX, blankY);
await page.mouse.down({ button: "right" });
await page.mouse.move(blankX - 40, blankY - 30, { steps: 4 });
await page.mouse.up({ button: "right" });
await page.keyboard.press("Delete");
await expect(map.locator(".smm-node", { hasText: "Child A" })).toBeVisible();
await expect(map.locator(".smm-node", { hasText: "Sibling B" })).toBeVisible();

await map.locator(".smm-node", { hasText: "Child A" }).click({ button: "right" });
await expect(page.getByRole("menu", { name: "节点操作" })).toBeVisible();
await page.keyboard.press("Escape");
```

Use both node bounding boxes to drag a left-button selection rectangle, then press Delete:

```ts
const childA = map.locator(".smm-node", { hasText: "Child A" });
const siblingB = map.locator(".smm-node", { hasText: "Sibling B" });
const boxes = await Promise.all([childA.boundingBox(), siblingB.boundingBox()]);
if (!boxes[0] || !boxes[1]) throw new Error("Expected both map nodes to have bounds");
const left = Math.min(boxes[0].x, boxes[1].x) - 12;
const top = Math.min(boxes[0].y, boxes[1].y) - 12;
const right = Math.max(boxes[0].x + boxes[0].width, boxes[1].x + boxes[1].width) + 12;
const bottom = Math.max(boxes[0].y + boxes[0].height, boxes[1].y + boxes[1].height) + 12;
await page.mouse.move(left, top);
await page.mouse.down({ button: "left" });
await page.mouse.move(right, bottom, { steps: 8 });
await page.mouse.up({ button: "left" });
await page.keyboard.press("Delete");
await expect(childA).toHaveCount(0);
await expect(siblingB).toHaveCount(0);
```

Finally read the active project's `project.json` and assert two subtree trash records were persisted.

- [ ] **Step 2: Run the focused E2E test and verify RED**

Run: `pnpm build && pnpm exec playwright test --grep "docked mind-map workspace"`

Expected: FAIL because left drag currently pans instead of selecting, so Delete does not remove both nodes.

- [ ] **Step 3: Enable the Select plugin's left-button mode**

Add this `MindMap` option while preserving `enableCtrlKeyNodeSelection: true`:

```ts
useLeftKeySelectionRightKeyDrag: true,
```

Do not add a custom rectangle or pointer listener; the registered Select plugin owns the marquee lifecycle and intersection detection.

- [ ] **Step 4: Route all active nodes through batch deletion**

Change the prop to `onDeleteNodes(nodeUids: string[]): void`. Add a helper inside the `MindMapPanel` setup:

```ts
const selectedUids = (): string[] => {
  const active = mindMap.renderer.activeNodeList as RenderedNode[];
  return active
    .filter((node) => node.uid !== mindMap.renderer.root?.uid)
    .map((node) => node.uid);
};
```

Use `selectedUids()` for the custom Delete/Backspace handler and the toolbar `REMOVE_NODE` branch. Keep right-menu deletion single-node with:

```tsx
onDelete={(nodeUid) => props.onDeleteNodes([nodeUid])}
```

In `App.tsx`, import `trashPortableSubtrees` and replace the callback with:

```tsx
onDeleteNodes={(nodeUids) => updateSnapshot((current) => trashPortableSubtrees(current, nodeUids))}
```

Copy, cut, and paste need no new handler because the library already reads `activeNodeList`, filters selected descendants, protects the root during cut, and publishes `data_change` after mutation.

- [ ] **Step 5: Build and run the focused Electron test for GREEN**

Run: `pnpm typecheck`

Expected: PASS with the renamed callback used at every call site.

Run: `pnpm build && pnpm exec playwright test --grep "docked mind-map workspace"`

Expected: PASS; right drag preserves nodes, right-click still opens the menu, left marquee deletes both selected nodes, and two trash records persist.

- [ ] **Step 6: Commit the marquee integration**

```bash
git add src/renderer/src/components/MindMapPanel.tsx src/renderer/src/App.tsx tests/e2e/app.spec.ts
git commit -m "feat: add marquee multiselect to the mind map"
```

### Task 3: Full regression and running Windows instance

**Files:**
- No source files are expected to change in this verification task.

**Interfaces:**
- Consumes: all Task 1 and Task 2 deliverables.
- Produces: a clean feature branch and a running updated Electron development instance.

- [ ] **Step 1: Run all unit and contract tests**

Run: `pnpm test`

Expected: every Vitest test passes with zero failures.

- [ ] **Step 2: Run static verification**

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm lint`

Expected: PASS with zero warnings.

- [ ] **Step 3: Build and run all Electron integration tests**

Run: `pnpm build`

Expected: main, preload, and renderer targets build successfully.

Run: `pnpm test:e2e`

Expected: all Electron tests pass, including the marquee and batch-trash workflow.

- [ ] **Step 4: Restart the development instance**

Stop the currently running `pnpm dev` session, then run `pnpm dev` again.

Expected: Electron opens with no startup error and remains running for manual selection testing.

If a verification command fails, return to the owning task, create a focused failing regression test, and repeat its RED/GREEN/commit sequence before restarting Task 3.
