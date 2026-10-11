// Executed in the page's main world with a user gesture. Capture the provider's
// own copy output without reading or modifying the user's system clipboard.
export async function copyMarkdownInPage(token: string): Promise<string | null> {
  const root = document.querySelector(`[data-mindmap-copy-target="${token}"]`);
  if (!root) return null;
  const icon = root.querySelector('.segment-assistant-actions-content [name="Copy"]');
  const button = icon?.closest<HTMLElement>('.icon-button');
  if (!button) return null;
  const result: { copied: string | null } = { copied: null };
  const clipboard = navigator.clipboard;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  const capture = (event: ClipboardEvent): void => {
    result.copied = event.clipboardData?.getData('text/plain') || null;
    if (!result.copied) {
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) result.copied = active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? active.value.length);
      else result.copied = document.getSelection()?.toString() || null;
    }
    event.preventDefault();
  };
  try {
    if (clipboard) {
      for (const method of ['writeText', 'write']) saved.set(method, Object.getOwnPropertyDescriptor(clipboard, method));
      Object.defineProperty(clipboard, 'writeText', { configurable: true, value: async (value: string) => { result.copied = String(value); } });
      Object.defineProperty(clipboard, 'write', { configurable: true, value: async (items: ClipboardItem[]) => {
        for (const item of items) if (item.types.includes('text/plain')) result.copied = await (await item.getType('text/plain')).text();
      } });
    }
    window.addEventListener('copy', capture);
    button.click();
    for (let attempt = 0; attempt < 20 && !result.copied; attempt++) await new Promise((resolve) => setTimeout(resolve, 50));
    return result.copied && result.copied.length <= 5_000_000 ? result.copied : null;
  } finally {
    window.removeEventListener('copy', capture);
    for (const [method, descriptor] of saved) {
      if (descriptor) Object.defineProperty(clipboard, method, descriptor);
      else delete (clipboard as unknown as Record<string, unknown>)[method];
    }
  }
}

export function mathFromMarkdown(markdown: string): Array<{ tex: string; display: boolean }> {
  const prose = markdown.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, '').replace(/(`+)[\s\S]*?\1/g, '');
  const formulas: Array<{ tex: string; display: boolean }> = [];
  for (const match of prose.matchAll(/(?<!\\)\$\$([\s\S]*?)\$\$|(?<!\\)\\\[([\s\S]*?)\\\]|(?<!\\)\\\(([\s\S]*?)\\\)|(?<![\\$])\$(?!\$)([^\n$]+?)(?<!\\)\$(?!\$)/g)) {
    const tex = match.slice(1).find((value) => value !== undefined)!.trim();
    if (tex) formulas.push({ tex, display: match[1] !== undefined || match[2] !== undefined });
  }
  return formulas;
}
