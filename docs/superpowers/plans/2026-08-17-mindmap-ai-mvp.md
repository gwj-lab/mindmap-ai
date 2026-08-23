# Mindmap AI Windows MVP Implementation Plan

> Implement in red-green-refactor slices and verify the complete application before handoff.

**Goal:** Deliver the source for a Windows Electron application that captures ChatGPT answers into local Markdown and links them to a dockable mind map.

**Architecture:** Electron owns files and remote web contents; a local React renderer hosts the dock layout and mind map; an isolated ChatGPT preload extracts answers. IPC contracts and project schemas are shared TypeScript modules.

**Tech Stack:** Electron 43, React 19, TypeScript, Vite, FlexLayout, simple-mind-map, CodeMirror 6, Vitest, Playwright.

## Work packages

1. Establish schemas, title/hash helpers, Markdown conversion, and storage through failing unit tests.
2. Add secure Electron windows, validated IPC, persistent ChatGPT session, capture preload, and panel-bound synchronization.
3. Build the dockable renderer, map controller, candidate workflow, style controls, and answer editor.
4. Add recovery, autosave, contract/integration tests, and full build verification.
