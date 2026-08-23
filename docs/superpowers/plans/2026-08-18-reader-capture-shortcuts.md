# Reader, Capture, and Shortcut Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct Markdown math and citation-icon rendering, change hover capture to explicit double-click capture, and make the mind-map's XMind-style shortcuts work reliably.

**Architecture:** Keep the existing capture, storage, and `simple-mind-map` command pipelines. Add the missing remark math parser and a focused Markdown preview component, simplify the preload hover controller to a highlighted double-click target, and supply `simple-mind-map` with an explicit shortcut-target policy that rejects text-editing contexts without rejecting SVG/FlexLayout focus.

**Tech Stack:** Electron 43, React 19, TypeScript 6, Vitest 4, Playwright 1.62, react-markdown 10, remark-math 6, rehype-katex 7, KaTeX 0.18, simple-mind-map 0.14.

## Global Constraints

- Windows 10/11 remains the only supported desktop platform for the MVP.
- Keep project Markdown portable: formulas stay as `$...$` and `$$...$$`; do not replace them with application-only markup.
- Continue to allow only HTTPS and mailto Markdown URLs; do not enable raw HTML or local file URLs.
- Hover capture highlights one assistant answer and captures only that answer on double-click.
- The current project `captureMode` remains the sole source for single-node versus expanded child-node generation.
- Reuse the existing `simple-mind-map` command system; do not implement a second map mutation engine.
- Do not download remote citation icons or content images into the project.

---

### Task 1: Portable math and bounded citation icons

**Files:**
- Create: `src/renderer/src/components/MarkdownPreview.tsx`
- Create: `tests/renderer/MarkdownPreview.test.tsx`
- Modify: `src/renderer/src/components/AnswerDialog.tsx`
- Modify: `src/renderer/src/styles.css`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Consumes: `safeLink(url: string): string` from `src/shared/content.ts`.
- Produces: `MarkdownPreview(props: { body: string; className?: string }): React.JSX.Element`.

- [ ] **Step 1: Write the failing Markdown renderer tests**

```tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { MarkdownPreview } from "../../src/renderer/src/components/MarkdownPreview.js";

describe("MarkdownPreview", () => {
  test("renders inline and display TeX through KaTeX", () => {
    const { container } = render(<MarkdownPreview body={"Inline $x^2$\n\n$$y = mx + b$$"} />);
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.querySelector(".katex-display")).not.toBeNull();
  });

  test("keeps citation icons inside links and ordinary images independent", () => {
    const { container } = render(<MarkdownPreview body={"[![source](https://example.com/icon.svg) Source](https://example.com/report)\n\n![Chart](https://example.com/chart.png)"} />);
    expect(container.querySelector("a > img")?.getAttribute("src")).toBe("https://example.com/icon.svg");
    expect(container.querySelector("p > img")?.getAttribute("src")).toBe("https://example.com/chart.png");
  });
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `pnpm test -- tests/renderer/MarkdownPreview.test.tsx`

Expected: FAIL because `MarkdownPreview.tsx` does not exist.

- [ ] **Step 3: Add the MIT-licensed remark parser and the minimal preview component**

Run: `pnpm add remark-math@6.0.0`

```tsx
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { safeLink } from "../../../shared/content.js";

export function MarkdownPreview({ body, className = "markdown-preview" }: { body: string; className?: string }): React.JSX.Element {
  return (
    <article className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false }]]}
        urlTransform={safeLink}
      >
        {body}
      </ReactMarkdown>
    </article>
  );
}
```

Replace the inline `ReactMarkdown` block in `AnswerDialog.tsx` with `<MarkdownPreview body={body} />` and remove its renderer-specific imports.

- [ ] **Step 4: Add separate visual rules for linked icons and content images**

```css
.markdown-preview img { max-width: 100%; height: auto; }
.markdown-preview a > img {
  display: inline-block;
  width: 14px;
  height: 14px;
  max-width: 14px;
  margin: 0 3px;
  object-fit: contain;
  vertical-align: -2px;
}
```

- [ ] **Step 5: Strengthen the existing Electron answer-reader flow**

Extend the answer body in `tests/e2e/app.spec.ts` with a display formula and a linked icon:

```ts
body: "## Captured integration answer\n\nA formula: $E = mc^2$\n\n$$x^2 + y^2 = z^2$$\n\n[![source](https://example.com/icon.svg) Source](https://example.com/report)"
```

After opening the reader, assert:

```ts
await expect(page.getByLabel("回答阅读器").locator(".katex")).toHaveCount(2);
await expect(page.getByLabel("回答阅读器").locator("a > img")).toHaveCSS("width", "14px");
await expect(page.getByLabel("回答阅读器").locator("a > img")).toHaveCSS("height", "14px");
```

- [ ] **Step 6: Run focused unit tests, typecheck, and the reader E2E test**

Run: `pnpm test -- tests/renderer/MarkdownPreview.test.tsx tests/shared/content.test.ts`

Expected: both test files PASS.

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm test:e2e -- --grep "captures a local answer"`

Expected: PASS with two rendered KaTeX expressions and a 14px linked icon.

- [ ] **Step 7: Commit the reader fix**

```bash
git add package.json pnpm-lock.yaml src/renderer/src/components/MarkdownPreview.tsx src/renderer/src/components/AnswerDialog.tsx src/renderer/src/styles.css tests/renderer/MarkdownPreview.test.tsx tests/e2e/app.spec.ts
git commit -m "fix: render answer math and citation icons"
```

### Task 2: Highlight-on-hover and capture-on-double-click

**Files:**
- Modify: `tests/preload/hover-capture.test.ts`
- Modify: `src/preload/hover-capture.ts`
- Modify: `src/preload/chatgpt.ts`
- Modify: `src/renderer/src/components/AiPanel.tsx`
- Modify: `tests/renderer/AiPanel.test.tsx`

**Interfaces:**
- Consumes: `findAssistantMessage(target: EventTarget | null): Element | null`, `isAssistantMessageStreaming(message: Element): boolean`, and the existing async `CaptureHoveredAnswer` callback.
- Produces: `HoverCaptureController(documentRef, capture, enabled?)` whose enabled mode highlights on hover and captures the active assistant answer on `dblclick`.

- [ ] **Step 1: Replace dwell-capture expectations with failing double-click tests**

Change `tests/preload/hover-capture.test.ts` to assert:

```ts
test("highlights on hover but captures only on double-click", async () => {
  const { first } = installTurns();
  const capture = vi.fn().mockResolvedValue(captured());
  const controller = new HoverCaptureController(document, capture);
  controller.start();

  first.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(document.querySelector("#first")?.classList.contains("mindmap-ai-hover-target")).toBe(true);
  expect(capture).not.toHaveBeenCalled();

  first.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  await Promise.resolve();
  expect(capture).toHaveBeenCalledTimes(1);
  expect(capture).toHaveBeenCalledWith(document.querySelector("#first"));
  controller.stop();
});
```

Add separate tests that double-clicking the second answer captures only `#second`, a second double-click while the promise is pending does not create another request, streaming content reports a failure badge without calling `capture`, and disabled mode ignores double-click.

- [ ] **Step 2: Run the controller tests and verify RED**

Run: `pnpm test -- tests/preload/hover-capture.test.ts`

Expected: FAIL because the existing controller captures after 600ms and has no double-click listener.

- [ ] **Step 3: Implement the minimal double-click controller**

Remove `normalizedText`, the dwell timer, and the mutation observer. Register and unregister a capture-phase `dblclick` listener in `start()` and `stop()`. The handler must follow this sequence:

```ts
const message = findAssistantMessage(event.target);
if (!this.enabled || !message || message !== this.#active || this.#capturing === message) return;
if (isAssistantMessageStreaming(message)) {
  renderCaptureBadge(message, { status: "failed", message: "回答仍在生成，请稍后双击" });
  return;
}
this.#capturing = message;
void this.capture(message)
  .then((acknowledgement) => renderCaptureBadge(message, acknowledgement))
  .catch((error: unknown) => renderCaptureBadge(message, {
    status: "failed",
    message: error instanceof Error ? error.message : "捕获失败"
  }))
  .finally(() => { if (this.#capturing === message) this.#capturing = null; });
```

Keep hover activation/deactivation and the existing status badge styles.

- [ ] **Step 4: Update construction and user-facing copy**

In `src/preload/chatgpt.ts`, instantiate the controller without a dwell duration. In `AiPanel.tsx`, change the toggle tooltip and accessible wording from a 600ms automatic capture promise to “悬停识别回答，双击捕获当前回答”. Keep the persisted `autoHoverCapture` field for schema compatibility.

Update `tests/renderer/AiPanel.test.tsx` to assert the new title text exists while the existing mode-switch and `setHoverCapture` expectations still pass.

- [ ] **Step 5: Run focused capture tests and adapter contracts**

Run: `pnpm test -- tests/preload/hover-capture.test.ts tests/preload/chatgpt-adapter.test.ts tests/renderer/AiPanel.test.tsx`

Expected: all tests PASS; no timer-triggered capture expectation remains.

- [ ] **Step 6: Commit the capture interaction**

```bash
git add tests/preload/hover-capture.test.ts src/preload/hover-capture.ts src/preload/chatgpt.ts src/renderer/src/components/AiPanel.tsx tests/renderer/AiPanel.test.tsx
git commit -m "feat: capture hovered answers on double click"
```

### Task 3: Reliable XMind-style shortcut focus policy

**Files:**
- Create: `src/renderer/src/components/map-shortcut-policy.ts`
- Create: `tests/renderer/map-shortcut-policy.test.ts`
- Modify: `src/renderer/src/components/MindMapPanel.tsx`
- Modify: `tests/e2e/app.spec.ts`

**Interfaces:**
- Produces: `shouldEnableMapShortcut(target: EventTarget | null): boolean`.
- Consumes: `simple-mind-map` option `customCheckEnableShortcut(event: KeyboardEvent): boolean`; existing built-in Tab, Enter, copy/cut/paste, undo/redo, and navigation commands.

- [ ] **Step 1: Write the failing focus-policy tests**

```ts
// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { shouldEnableMapShortcut } from "../../src/renderer/src/components/map-shortcut-policy.js";

describe("mind-map shortcut target policy", () => {
  test("allows body, SVG, and stale toolbar-button focus", () => {
    expect(shouldEnableMapShortcut(document.body)).toBe(true);
    expect(shouldEnableMapShortcut(document.createElementNS("http://www.w3.org/2000/svg", "text"))).toBe(true);
    expect(shouldEnableMapShortcut(document.createElement("button"))).toBe(true);
  });

  test("rejects text editors and dialog/menu controls", () => {
    document.body.innerHTML = '<input id="input"><div class="cm-editor"><div id="cm"></div></div><aside class="answer-dialog"><button id="dialog-button"></button></aside><div class="node-context-menu"><button id="menu-button"></button></div>';
    expect(shouldEnableMapShortcut(document.querySelector("#input"))).toBe(false);
    expect(shouldEnableMapShortcut(document.querySelector("#cm"))).toBe(false);
    expect(shouldEnableMapShortcut(document.querySelector("#dialog-button"))).toBe(false);
    expect(shouldEnableMapShortcut(document.querySelector("#menu-button"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `pnpm test -- tests/renderer/map-shortcut-policy.test.ts`

Expected: FAIL because `map-shortcut-policy.ts` does not exist.

- [ ] **Step 3: Implement the focused policy**

```ts
const BLOCKED_SHORTCUT_TARGETS = [
  "input", "textarea", "select", "[contenteditable='true']",
  ".cm-editor", ".answer-dialog", ".node-context-menu", ".dialog-backdrop"
].join(",");

export function shouldEnableMapShortcut(target: EventTarget | null): boolean {
  return !(target instanceof Element) || target.closest(BLOCKED_SHORTCUT_TARGETS) === null;
}
```

Pass it into the `MindMap` constructor:

```ts
customCheckEnableShortcut: (event: KeyboardEvent) => shouldEnableMapShortcut(event.target)
```

Keep `enableShortcutOnlyWhenMouseInSvg: true`, so shortcuts still require the pointer to be in the active map. Keep the existing root-delete guard, F2/Space rename handler, Ctrl+Enter expand handler, and `simple-mind-map` built-ins.

- [ ] **Step 4: Add a real Electron shortcut workflow**

In the workspace E2E test, add the following workflow after the SVG becomes visible (use the actual text-edit selector exposed by the installed library if its contenteditable has a library class in the rendered DOM):

```ts
const map = page.locator(".mindmap-canvas");
const root = map.locator(".smm-node", { hasText: "中心主题" }).first();
await root.click();
await map.locator("svg").hover();
await page.keyboard.press("Tab");
const editor = page.locator("[contenteditable='true']:visible");
await editor.fill("Child A");
await page.keyboard.press("Enter");
await expect(map.locator(".smm-node", { hasText: "Child A" })).toBeVisible();

await map.locator(".smm-node", { hasText: "Child A" }).click();
await map.locator("svg").hover();
await page.keyboard.press("Enter");
await editor.fill("Sibling B");
await page.keyboard.press("Enter");
await expect(map.locator(".smm-node", { hasText: "Sibling B" })).toBeVisible();

await map.locator(".smm-node", { hasText: "Sibling B" }).click();
await map.locator("svg").hover();
await page.keyboard.press("Delete");
await expect(map.locator(".smm-node", { hasText: "Sibling B" })).toHaveCount(0);
```

The focus-blocking behavior is covered by the policy unit test; do not synthesize a production-only input in the Electron application.

- [ ] **Step 5: Run focused policy and Electron shortcut tests**

Run: `pnpm test -- tests/renderer/map-shortcut-policy.test.ts`

Expected: PASS.

Run: `pnpm test:e2e -- --grep "docked mind-map workspace"`

Expected: PASS with Tab, Enter, and Delete mutating the map only when the map is active.

- [ ] **Step 6: Commit the shortcut fix**

```bash
git add src/renderer/src/components/map-shortcut-policy.ts src/renderer/src/components/MindMapPanel.tsx tests/renderer/map-shortcut-policy.test.ts tests/e2e/app.spec.ts
git commit -m "fix: enable XMind shortcuts on the map canvas"
```

### Task 4: Full regression and Windows development build verification

**Files:**
- No source files are expected to change in this verification task.

**Interfaces:**
- Consumes: all deliverables from Tasks 1-3.
- Produces: a clean, runnable Electron development build with no known regression in capture, project persistence, Markdown portability, or map operations.

- [ ] **Step 1: Run every unit and contract test**

Run: `pnpm test`

Expected: all Vitest files and tests PASS with no unhandled errors.

- [ ] **Step 2: Run static verification**

Run: `pnpm typecheck`

Expected: PASS.

Run: `pnpm lint`

Expected: PASS with zero warnings.

- [ ] **Step 3: Build every Electron target**

Run: `pnpm build`

Expected: main, preload, and renderer builds PASS; the ChatGPT preload contains the new double-click controller.

- [ ] **Step 4: Run the full Electron integration suite**

Run: `pnpm test:e2e`

Expected: every Playwright Electron test PASS, including KaTeX/icon rendering and the map shortcut workflow.

- [ ] **Step 5: Start the Windows development application and inspect startup logs**

Run: `pnpm dev`

Expected: Electron opens, `http://localhost:5173/` is served, and the main/preload/renderer processes report no startup exception. Keep the process running for the user's manual ChatGPT login verification.

If any verification command fails, return to the task that owns the behavior, add a focused failing regression test, and repeat that task's RED/GREEN/commit sequence before restarting Task 4.
