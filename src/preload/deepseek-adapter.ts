import { replaceCode, serializeAnswer } from './answer-markdown.js';
import { captureRichSnapshot, snapshotMarkdown } from '../shared/rich-answer.js';

export const deepseekAdapter = {
  messageSelector: '.ds-message:has(.ds-assistant-message-main-content), [data-message-author-role="assistant"]',
  content: (message: Element): Element => message.querySelector('.ds-assistant-message-main-content') ?? message,
  toMarkdown: deepseekToMarkdown
};

export function deepseekToMarkdown(content: Element, sourceUrl: string): string {
  const root = content.cloneNode(true) as Element;
  const originalPanes = [...content.querySelectorAll('.md-code-block')];
  root.querySelectorAll('.md-code-block').forEach((pane, index) => {
    const pre = pane.querySelector('pre');
    if (pre) {
      const label = pane.querySelector('.md-code-block-banner .d813de27')?.textContent?.trim() ?? '';
      const language = pane.querySelector('[role="tab"]') ? 'mermaid' : label;
      replaceCode(pane, pre.querySelector('code') ?? pre, language);
    } else if (pane.querySelector('svg')) {
      const marker = root.ownerDocument.createElement('div');
      marker.setAttribute('data-answer-snapshot', 'true');
      marker.textContent = snapshotMarkdown(captureRichSnapshot(originalPanes[index]));
      pane.replaceWith(marker);
    }
  });
  root.querySelectorAll('.ds-markdown-task-list-item').forEach((item) => {
    const marker = item.querySelector('input, [role="checkbox"]');
    if (marker) return;
    const glyph = item.querySelector('.ds-markdown-task-checkbox');
    const checked = glyph?.textContent?.includes('☑') ?? item.classList.contains('ds-markdown-task-list-item-checked');
    glyph?.remove();
    item.querySelectorAll(':scope > p').forEach((paragraph) => paragraph.replaceWith(...paragraph.childNodes));
    item.prepend(root.ownerDocument.createTextNode(checked ? '[x] ' : '[ ] '));
  });
  root.querySelectorAll('[role="tablist"], .md-code-block-banner-wrap, .ds-icon-button, .ds-button, .ds-think-content').forEach((element) => element.remove());
  return serializeAnswer(root, sourceUrl);
}
