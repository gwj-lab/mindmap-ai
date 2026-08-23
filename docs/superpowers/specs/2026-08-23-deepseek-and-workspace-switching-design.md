# DeepSeek Diagnostics and Workspace Switching Design

## Goal

Make first-time DeepSeek configuration reliable and diagnosable, restore the last workspace at startup, and let users switch among recent workspaces without leaving the application.

## API connection

The existing OpenAI-compatible HTTPS request path remains dependency-free. The settings page adds an explicit DeepSeek preset (`https://api.deepseek.com`, `deepseek-chat`) and a connection test that uses the unsaved form values plus either a newly entered key or the encrypted saved key.

Changing Base URL requires confirmation only when an encrypted key already exists and could subsequently be sent to a different origin. A first-time Base URL change with no saved key must succeed without confirmation. HTTPS, credential-free URLs, response-size limits, request timeouts, and OS-backed key encryption remain mandatory.

Connection tests return structured, non-secret-safe results. Common HTTP statuses map to actionable Chinese messages (authentication, balance, forbidden access, unknown endpoint/model, rate limiting, and provider outage). Raw request headers, keys, and arbitrary provider response bodies never reach the renderer or logs.

Normal title extraction still falls back to local rules so capture is not lost. When a real API attempt fails, the captured acknowledgement includes a safe warning and the renderer tells the user that local extraction was used.

## Recent workspace lifecycle

Application-local `recent-workspaces.json` lives beneath Electron `userData`, separate from portable workspace data. It stores at most ten entries containing an opaque UUID, display name, absolute path, and last-opened timestamp. Renderer requests use the opaque UUID; only the main process resolves it to a filesystem path.

Successful workspace create/open/switch operations update the MRU list. On renderer startup, the main process attempts to load the most recently opened workspace. If it is missing or invalid, that entry is removed, the application opens the workspace chooser screen, and a warning explains why automatic restore failed.

The top bar exposes a “switch workspace” action. Its in-app dialog lists recent workspace names and full paths, and provides actions to select a recent entry, forget an entry, open another folder, or create a workspace. Switching first flushes dirty project state; a failed save cancels the switch. The candidate workspace is fully loaded before it replaces the active main-process store.

## Components

- `RecentWorkspaceStore`: atomic, validated MRU persistence and opaque-ID lookup.
- Main IPC handlers: restore last workspace, list recents, switch by ID, and forget by ID.
- Zustand project state: startup initialization and serialized safe workspace switching.
- `WorkspaceSwitcher`: accessible modal containing recent entries and fallback actions.
- `TitleService`: shared OpenAI-compatible request execution with safe failure classification.
- `AiSettingsPage`: DeepSeek preset and connection-test controls.

## Error handling and security

Corrupt recent-history JSON behaves as an empty list. Workspace contents are never deleted when a history entry is forgotten or invalid. HTTPS certificate verification remains enabled. Base URLs may not contain embedded credentials. API keys stay encrypted in the main process and are never returned through IPC.

## Testing

Unit and component tests cover the first-time Base URL regression, DeepSeek endpoint/preset behavior, safe connection diagnostics, visible local-fallback warnings, MRU ordering and corruption recovery, startup restore, save-before-switch behavior, invalid recent paths, and workspace-switcher interaction. Type checking, linting, production build, unit tests, and Electron end-to-end tests provide final verification.
