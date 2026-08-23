# API Configuration, Repeat Capture, Project Creation, and Content Indicator Design

**Date:** 2026-08-22  
**Status:** Approved for implementation planning

## Goal

Complete four related product flows in Mindmap AI:

1. Make root and child project creation work reliably in Electron.
2. Expose one discoverable OpenAI-compatible API configuration page for AI-assisted title and child-plan generation.
3. Allow the same source answer to be captured any number of times as independent copies.
4. Visually distinguish mind-map nodes that link to captured Markdown content from title-only nodes.

The implementation should preserve the existing local-first storage model, encrypted API-key boundary, single-node and expanded-node modes, local extraction fallback, portable project format, and current project lifecycle operations.

## Scope and Non-goals

The first API configuration version stores one OpenAI-compatible connection containing a Base URL, model name, and API key. It does not provide multiple saved providers, provider switching, automatic model discovery, per-project API credentials, or a general workflow system.

Every capture creates an independent answer document and candidate. Source URL, source message ID, and content hash remain traceability metadata but no longer impose uniqueness.

Only a node directly linked to captured Markdown content receives the content indicator. AI-generated child plans remain title-only nodes unless they later receive captured content through another supported workflow.

## Existing-System Findings

- Root and child creation currently call `window.prompt`. Electron does not support `prompt`, so the callback can fire while no usable naming UI appears.
- The capture service scans all answer documents and returns `duplicate` when provider, source URL, source message ID, and content hash match. Deleting a candidate or map node does not delete that answer document, so future captures remain blocked.
- The existing AI settings dialog already stores one HTTPS OpenAI-compatible endpoint, model, and encrypted API key. The main process performs requests and the renderer sees only public settings and whether a key exists.
- The capture pipeline already passes the active project's `single` or `expanded` mode to the title service. Expanded mode produces an ordered list capped at 12 child titles and falls back to local extraction on API failure.
- Captured map nodes already persist `answerId`. The existing `simple-mind-map` dependency can render a small note-style icon without adding a new package.

## Chosen Approach

Extend the current architecture instead of introducing a provider framework. Reuse the existing settings store, IPC boundary, title service, capture modes, and `simple-mind-map` rendering hooks. Replace unsupported native prompt usage with an application-owned dialog and turn the settings modal into a discoverable workspace page shared by both entry points.

Open-source reuse is intentionally narrow:

- Follow the connection-information pattern used by Open WebUI: endpoint, API key, and explicit model identifier in one connection surface.
- Reuse `simple-mind-map`'s note-style node icon as the visual content indicator.
- Add no new runtime dependency.

## User Experience

### Project creation

The left project navigator keeps its “新建主项目” button and child-project menu action. Both open the same application-owned naming dialog with context-specific labels.

The dialog:

- starts with “新项目” selected for quick replacement;
- submits with the primary button or Enter;
- closes without changes on Cancel or Escape;
- rejects a blank or whitespace-only name;
- respects the existing project-name length limit;
- remains open and shows the returned error if project creation fails;
- disables duplicate submissions while creation is in progress.

The active answer dialog closes only after a valid project creation request begins, matching the existing project-switch behavior.

### API configuration page

The bottom of the left project rail contains a fixed “API 配置” entry alongside the root-project creation control. Selecting it replaces the central dock workspace with a settings page. A Back/Close control restores the project's previous dock layout without modifying that layout.

The AI panel's gear remains as a shortcut and opens the same page. There is one settings implementation and one state flow, not a separate modal and page.

The page contains:

- title-source choice: local, automatic, or API-preferred;
- Base URL;
- model identifier;
- masked API-key replacement field;
- key configured/not-configured status;
- clear-key action;
- save progress, success, validation, and failure messages;
- a concise usage explanation for both capture modes.

The explanation states:

- single-node mode asks the model for one concise candidate title and no child plans;
- expanded-node mode asks for one candidate title and up to 12 ordered child plans;
- an unavailable or invalid API response falls back to local extraction without losing the capture.

### Content indicator

A map node with a non-empty `answerId` displays a small note-style indicator at its lower content edge. Hover text communicates that the node contains captured content. Title-only nodes do not display it.

In expanded mode, the captured root candidate becomes an answer-linked node and receives the indicator. Its generated child plans remain title-only and receive no indicator.

The indicator is derived at render time from `answerId`. It is not stored as another business-data property, so project history, trash, restore, export, reopen, and schema compatibility naturally retain the correct display.

## Data Flow and Component Boundaries

### Project naming

`App` owns one nullable project-creation request containing `parentProjectId`. `ProjectNavigator` reports intent only. A focused naming-dialog component owns the input, validation presentation, submitting state, and keyboard behavior. On submit, `App` calls the existing Zustand project action, which saves dirty state before invoking the existing validated project-creation IPC call.

The project action returns an explicit success/failure result or throws to the dialog-facing caller rather than swallowing all failures into a toast. Global state and the dialog can therefore stay consistent: success closes the dialog and activates the new project; failure leaves the dialog open and displays the error.

### API configuration

One settings-page component loads public settings through the existing preload API. It never receives the stored key. Saving public settings and setting or clearing the key continue through separate validated IPC calls.

The title source remains a project UI preference because different projects may choose local, automatic, or API-preferred behavior. The connection itself remains application-level because the encrypted key and endpoint are shared by the app.

At capture time, the main process reads the active project's capture mode and title-source preference. If API use is enabled and a key is available, it sends the Markdown content through the existing title service. The service requests strict JSON and normalizes the result. Failure returns local extraction output.

### Repeat capture

The capture service stops treating provider/source/message/hash as a uniqueness key. For every accepted capture request it creates:

- a fresh answer UUID;
- a fresh candidate ID derived from that answer UUID;
- a fresh Markdown answer file;
- fresh expanded child IDs when applicable.

The existing delivery controller may still prevent two simultaneous requests for the same active hover target while one request is in flight. That concurrency guard prevents accidental double submission; it does not block a later deliberate capture.

Answer metadata continues to record source URL, source message ID, and content hash for provenance and later analysis. Existing answer documents require no migration.

### Indicator rendering

The domain model remains `MindMapNodeData { answerId?: string }`. The adapter that converts domain nodes into `simple-mind-map` data injects the note-style display property only when `answerId` exists. The reverse adapter ignores that display-only property and continues to recover `answerId` directly.

This boundary prevents the visual marker from becoming editable note content or polluting portable project files.

## Security and Failure Handling

- The API key remains encrypted by Electron `safeStorage` and written only by the main process.
- The renderer can learn only whether a key is saved; it cannot read the key back.
- Base URLs must be credential-free HTTPS URLs. URL usernames, passwords, fragments, and query strings are rejected or removed according to the existing normalization contract.
- Changing the Base URL while a key exists requires explicit confirmation before that key can be sent to the new origin.
- Requests remain time-limited and input/response-size-limited. Response envelopes and extracted JSON remain schema validated.
- API errors, timeouts, non-2xx responses, malformed JSON, and invalid model output fall back locally.
- Project creation errors remain visible in the naming dialog and do not clear user input.
- Capture persistence retains its current consistency contract: a failed operation must not surface a captured acknowledgement or leave an unmatched candidate. Existing reconciliation continues to recover an answer written immediately before an interrupted candidate write.

## Testing Strategy

### Project creation

- Component tests cover opening the root and child naming flows, selected default text, blank validation, Enter, Escape, Cancel, loading state, and server error retention.
- An App-level test covers the project navigator intent through the naming dialog to `createNestedProject`, proving the flow no longer relies on `window.prompt`.
- Existing project navigator tests continue to validate intent callbacks independently.

### Repeat capture

- Replace the duplicate expectation with a regression test that captures an identical payload twice and receives two `captured` acknowledgements with distinct answer and candidate IDs.
- Verify two answer files and two candidates persist.
- Verify API extraction runs for each deliberate capture.
- Verify capture still succeeds after the first candidate is deleted, attached to the map, moved to history, or trashed, because none of those states define capture uniqueness.
- Retain tests for answer-write failure and interrupted answer/candidate persistence recovery.

### API behavior

- Retain and extend tests for single-mode title-only output.
- Retain and extend tests for expanded-mode ordered children, normalization, duplicate removal, and the 12-child limit.
- Cover local, automatic without key, automatic with key, and API-preferred failure fallback.
- Cover public settings validation, encrypted-key status, key replacement, clearing, and Base URL change confirmation.
- Page tests cover loading, saving, error display, and both navigation entry points.

### Content indicator

- Adapter tests verify that an `answerId` produces the display marker and a title-only node does not.
- Round-trip tests verify the display marker is not persisted as domain content.
- Map component tests cover single captured nodes and expanded roots with title-only children.
- Existing history, trash, restore, and portable workspace tests verify `answerId` survives lifecycle operations.

### Completion verification

Run:

```powershell
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm test:e2e
```

Manually verify on Windows that project naming accepts keyboard input, API settings can be opened from both entries, repeated capture produces multiple candidates, and the content indicator remains visible after save and reopen.

## Acceptance Criteria

1. Clicking “新建主项目” always opens a usable in-app naming dialog, and a valid name creates and activates a root project.
2. Child project creation uses the same working dialog with the correct parent.
3. The API configuration page is reachable from the left project rail and AI-panel gear and edits one OpenAI-compatible connection.
4. The API key never becomes readable by renderer code or plaintext workspace/export data.
5. Single-node mode produces one answer-linked candidate title; expanded mode produces one answer-linked candidate title and at most 12 ordered title-only child plans.
6. API failure falls back locally without losing the captured answer or candidate.
7. Identical source content can be captured repeatedly without limit, and every successful capture creates independent answer and candidate records.
8. Deleting, trashing, restoring, attaching, or permanently deleting one captured copy does not prevent another capture.
9. Every answer-linked map node shows a small content indicator; title-only nodes do not.
10. Existing portable projects open without migration and derive indicators correctly from persisted `answerId` values.

