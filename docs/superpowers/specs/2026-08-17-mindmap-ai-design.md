# Mindmap AI Windows MVP Design

Mindmap AI is a local-first Windows research workspace. It combines a dockable mind map, a sandboxed ChatGPT web session, a candidate-answer tray, and Markdown reading/editing.

The Electron main process exclusively owns project paths, disk writes, and remote `WebContentsView` instances. The local React renderer receives a narrow typed IPC bridge. The ChatGPT preload can inspect the remote DOM and send extracted answer payloads, but cannot access Node.js or project files.

Each captured answer becomes `answers/<uuid>.md` and a candidate record. Dropping a candidate on a map node creates an answer-linked child and consumes the candidate. Project JSON and Markdown writes are serialized and atomic. The workspace restores its map, dock layout, candidates, and UI preferences on reopen.

The first release supports Windows 10/11, one active project, and one ChatGPT provider. It saves linked images as HTTPS URLs and ships as source only.
