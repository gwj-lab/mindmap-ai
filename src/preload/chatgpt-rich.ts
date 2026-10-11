import { replaceCode, serializeAnswer } from './answer-markdown.js';
import { captureRichSnapshot, snapshotMarkdown } from '../shared/rich-answer.js';

export function isRichChatgpt(content: Element): boolean {
  return content.matches('[data-dil-message-id], [data-d-component], [data-w-component]') || Boolean(content.querySelector('[data-dil-message-id], [data-d-component], [data-w-component]'));
}

export function chatgptRichToMarkdown(content: Element, sourceUrl: string): string {
  const parts = [...content.querySelectorAll('[data-markdown-text-style="assistant-message"]')];
  const sources = parts.length > 1 ? parts : [content];
  const root = sources.length === 1 ? content.cloneNode(true) as Element : content.ownerDocument.createElement('div');
  if (sources.length > 1) sources.forEach((part) => root.append(part.cloneNode(true)));
  root.querySelectorAll('[data-markdown-copy="code-block"]').forEach((pane) => {
    const source = pane.querySelector('code');
    if (source) replaceCode(pane, source, pane.querySelector('[data-markdown-copy="exclude"] .truncate')?.textContent?.trim().toLowerCase() ?? '');
  });
  root.querySelectorAll('[data-markdown-copy="inline-code"]').forEach((element) => {
    const code = root.ownerDocument.createElement('code'); code.textContent = element.textContent; element.replaceWith(code);
  });
  root.querySelectorAll('[hidden], [data-d-component="favicon"], [data-d-component="icon"], .recharts-tooltip-wrapper').forEach((element) => element.remove());
  root.querySelectorAll('[data-d-default-strong], [data-d-weight="bold"], [data-d-weight="semibold"][data-d-inline]').forEach((element) => {
    const strong = root.ownerDocument.createElement('strong');
    strong.append(...element.childNodes);
    element.replaceWith(strong);
  });
  root.querySelectorAll('[data-d-font-style="italic"], [data-d-text-decoration="line-through"]').forEach((element) => {
    const replacement = root.ownerDocument.createElement(element.getAttribute('data-d-font-style') === 'italic' ? 'em' : 'del');
    replacement.append(...element.childNodes); element.replaceWith(replacement);
  });
  root.querySelectorAll('th[data-d-align], td[data-d-align]').forEach((cell) => {
    const alignment = cell.getAttribute('data-d-align')!;
    cell.setAttribute('align', ({start:'left',end:'right',center:'center'} as Record<string,string>)[alignment] ?? alignment);
  });
  root.querySelectorAll('[data-d-component="caption"]').forEach((element) => {
    const paragraph = root.ownerDocument.createElement('p'); paragraph.append(...element.childNodes); element.replaceWith(paragraph);
  });
  // Native chart accessibility lists contain exact values; the SVG axes do not.
  root.querySelectorAll('[data-w-component="chart"]').forEach((chart) => chart.remove());
  root.querySelectorAll('[role="img"]').forEach((element) => {
    const label = element.getAttribute('aria-label');
    if (label && !element.textContent?.trim()) element.textContent = label;
  });
  root.querySelectorAll('input, textarea, select').forEach((element) => {
    if (element.matches('input[type="checkbox"]')) return;
    const value = element.getAttribute('value') ?? element.textContent ?? '';
    element.replaceWith(root.ownerDocument.createTextNode(`${element.getAttribute('aria-label') ?? ''}: ${value}`));
  });
  // Content controls are part of an answer, unlike copy/share toolbars.
  root.querySelectorAll('[data-d-component="button"]').forEach((button) => {
    const label = root.ownerDocument.createElement('span'); label.textContent = button.textContent; button.replaceWith(label);
  });
  root.querySelectorAll('[data-markdown-copy="exclude"], [data-d-component="favicon"], .sr-only[data-conversation-role]').forEach((element) => element.remove());
  return `${serializeAnswer(root, sourceUrl)}\n\n${sources.map((part) => snapshotMarkdown(captureRichSnapshot(part))).join('\n\n')}`;
}
