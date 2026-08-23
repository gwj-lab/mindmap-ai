const BLOCKED_SHORTCUT_TARGETS = [
  "input",
  "textarea",
  "select",
  "[contenteditable]:not([contenteditable='false'])",
  ".cm-editor",
  ".answer-dialog",
  ".node-context-menu",
  ".dialog-backdrop"
].join(",");

export function shouldEnableMapShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(".smm-node-edit-wrap")) return true;
  return target.closest(BLOCKED_SHORTCUT_TARGETS) === null;
}
