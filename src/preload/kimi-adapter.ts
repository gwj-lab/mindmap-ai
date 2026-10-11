import { replaceCode, replaceMath, serializeAnswer } from './answer-markdown.js';
import { captureRichSnapshot, snapshotMarkdown } from '../shared/rich-answer.js';
import { mathFromMarkdown } from '../shared/page-copy.js';

export const kimiAdapter = {
  messageSelector: '.chat-content-item-assistant, .segment-assistant, [data-message-author-role="assistant"]',
  content: (message: Element): Element => {
    return message.querySelector('.segment-content-box, .segment-content') ?? message;
  },
  toMarkdown: kimiToMarkdown
};

export function kimiToMarkdown(content: Element, sourceUrl: string, nativeMarkdown?: string): string {
  const root = content.cloneNode(true) as Element;
  root.querySelectorAll('.toolcall-content-text, .toolcall-flow').forEach((element) => element.remove());
  root.querySelectorAll('.markdown-table').forEach((wrapper) => {
    const header = wrapper.querySelector('table.header-table');
    const body = wrapper.querySelector('table.body-table');
    if (header && body) {
      const table = root.ownerDocument.createElement('table');
      const head = header.querySelector('thead'); const rows = body.querySelector('tbody');
      if (head) table.append(head); if (rows) table.append(rows);
      wrapper.replaceWith(table);
    }
  });
  const originals = [...content.querySelectorAll('.katex-wrapper')].filter((element) => !element.closest('.toolcall-content-text, .toolcall-flow'));
  const formulas = nativeMarkdown ? mathFromMarkdown(nativeMarkdown) : [];
  const canRecover = formulas.length === originals.length;
  root.querySelectorAll('.katex-wrapper').forEach((element, index) => {
    const tex = element.getAttribute('data-tex') ?? element.getAttribute('data-latex') ?? element.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? (canRecover ? formulas[index]?.tex : undefined);
    if (tex) replaceMath(element, tex, element.classList.contains('math-display'));
    else {
      // Kimi renders KaTeX HTML without TeX annotations. Preserve the actual
      // equation instead of guessing a formula from duplicated glyph text.
      const marker = root.ownerDocument.createElement('div');
      marker.setAttribute('data-answer-snapshot', 'true');
      marker.textContent = snapshotMarkdown(captureRichSnapshot(originals[index]));
      element.replaceWith(marker);
    }
  });
  root.querySelectorAll('.markdown-mermaid').forEach((pane) => {
    const code = pane.querySelector('pre code');
    if (code) replaceCode(pane, code, 'mermaid');
  });
  root.querySelectorAll('pre').forEach((pre) => {
    if (!root.contains(pre)) return;
    const wrapper = pre.closest('.segment-code');
    const code = pre.querySelector('code');
    if (code) replaceCode(wrapper ?? pre, code, pre.className.match(/language-([\w+-]+)/)?.[1] ?? '');
  });
  root.querySelectorAll('.paragraph').forEach((element) => {
    const paragraph = root.ownerDocument.createElement('p'); paragraph.append(...element.childNodes); element.replaceWith(paragraph);
  });
  root.querySelectorAll('.segment-code-header, .markdown-header, .table-buttons, .segment-assistant-actions, .segment-avatar, .toolcall-content-text, .toolcall-flow').forEach((element) => element.remove());
  return serializeAnswer(root, sourceUrl);
}
