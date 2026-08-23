export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target.isContentEditable
    || target.contentEditable === "true"
    || target.getAttribute("contenteditable") === "true"
    || Boolean(target.closest(".cm-editor, [contenteditable='true']"));
}
