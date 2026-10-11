// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeEach, expect, test } from 'vitest';
import { extractLatestAnswer, extractAnswerFromTarget, findAssistantMessage } from '../../src/preload/answer-adapter.js';
import { kimiToMarkdown } from '../../src/preload/kimi-adapter.js';
import { deepseekToMarkdown } from '../../src/preload/deepseek-adapter.js';
import { readRichSnapshot, sanitizeRichHtml } from '../../src/shared/rich-answer.js';
import { captureRichSnapshot } from '../../src/shared/rich-answer.js';
import { mathFromMarkdown, copyMarkdownInPage } from '../../src/shared/page-copy.js';
import { capturedAnswerPayloadSchema, aiTabsSchema } from '../../src/shared/ipc.js';
import { answerDocumentSchema } from '../../src/shared/project.js';
import { classifyNavigation } from '../../src/shared/security.js';

const fixture = (provider: string, name: string) => readFileSync(`tests/fixtures/${provider}/${name}.html`, 'utf8');
beforeEach(() => { document.body.innerHTML = ''; });

test.each([
  ['deepseek', '<div class="ds-button--primary ds-button--circle"><div class="ds-loading"></div></div>'],
  ['deepseek', '<div class="ds-button--primary ds-button--circle"><svg><path d="M2 4.88C2 3.68009"></path></svg></div>'],
  ['kimi', '<div class="send-button-container loading"></div>'],
  ['kimi', '<div class="send-button-container disabled stop"><svg name="stop"></svg></div>']
] as const)('%s rejects latest capture with the observed waiting/stop control', async (provider, control) => {
  const url = provider === 'deepseek' ? 'https://chat.deepseek.com/' : 'https://www.kimi.com/';
  const message = provider === 'deepseek' ? '<div class="ds-message"><div class="ds-assistant-message-main-content">Answer</div></div>' : '<div class="chat-content-item-assistant"><div class="markdown">Answer</div></div>';
  document.body.innerHTML = message + message + control;
  expect(await extractLatestAnswer(document, url)).toBeNull();
  expect((await extractAnswerFromTarget(document.body.firstElementChild, url))?.markdown).toBe('Answer');
  document.body.lastElementChild!.remove();
  expect((await extractLatestAnswer(document, url))?.markdown).toBe('Answer');
});

test('multipart Intelligent UI captures every original part without toolbars', async () => {
  document.body.innerHTML = '<article data-message-author-role="assistant"><div data-markdown-text-style="assistant-message"><p data-d-component="text">First</p></div><div data-markdown-text-style="assistant-message"><p data-d-component="text">Second</p></div><button>Copy toolbar</button></article>';
  const result = await extractLatestAnswer(document, 'https://chatgpt.com/c/multi');
  expect(result?.markdown).toContain('First\n\nSecond');
  expect(result?.markdown.match(/```mindmap-ui/g)).toHaveLength(2);
  expect(result?.markdown).not.toContain('Copy toolbar');
});

test('formula snapshots retain native relative offsets and hidden elements remain hidden', () => {
  const formula = document.createElement('span'); formula.className = 'katex-wrapper';
  formula.innerHTML = '<span class="vlist" style="height:1.69em"><span style="top:-3.69em">x</span></span><span hidden>hidden</span>';
  const snapshot = captureRichSnapshot(formula);
  expect(snapshot.html).toContain('height:1.69em');
  expect(snapshot.html).toContain('top:-3.69em');
  expect(snapshot.html).toContain('hidden');
});

test('real Intelligent UI: retains emphasis, chart values, both tables and snapshot', async () => {
  document.body.innerHTML = fixture('chatgpt', 'intelligent-ui-answer');
  const original = document.body.innerHTML;
  const result = await extractLatestAnswer(document, 'https://chatgpt.com/c/rich');
  expect(result?.sourceMessageId).toBe('eeb6c9b8-aaaa-4796-99c2-4ae58daead97');
  expect(result?.markdown).toContain('**DAU（日活跃用户）**');
  expect(result?.markdown).toContain('420');
  expect(result?.markdown).toContain('DeepSeek');
  expect(result?.markdown).toContain('mindmap-ui');
  expect(result?.markdown).toContain('recharts-surface');
  expect(result?.markdown).toContain('**结论：**');
  expect(result?.markdown).toContain('| --- | --- | ---: |');
  expect(result?.markdown.includes('共享')).toBe(false);
  expect(document.body.innerHTML).toBe(original);
  expect((await extractAnswerFromTarget(document.querySelector('[data-w-component="chart"]'), result!.sourceUrl))?.markdown).toBe(result?.markdown);
});

test('real DeepSeek: exact TeX, code language/whitespace, Mermaid code and answer boundary', async () => {
  document.body.innerHTML = fixture('deepseek', 'format-answer-code');
  const result = await extractLatestAnswer(document, 'https://chat.deepseek.com/a/chat/s/format');
  expect(result?.provider).toBe('deepseek');
  expect(result?.sourceMessageId).toBe('2');
  for (const annotation of document.querySelectorAll('annotation[encoding="application/x-tex"]')) expect(result?.markdown).toContain(annotation.textContent!.trim());
  for (const pre of document.querySelectorAll('pre')) expect(result?.markdown).toContain(pre.textContent!.replace(/\n$/, ''));
  for (const language of ['javascript', 'python', 'mermaid', 'text']) expect(result?.markdown).toContain('```' + language);
  expect(result?.markdown).toContain('3.  第三项');
  expect(result?.markdown).toContain('单元格里有竖线：\\|');
  expect(result?.markdown).toContain('<br>第二行');
  expect(result?.markdown).toContain('[^1]: 这是第一个脚注。');
  expect(result?.markdown).toContain('[^note]: 这是带名称的脚注。');
  expect(result?.markdown).toContain('脚注引用：[^1]');
  expect(result?.markdown).not.toContain('复制');
  const diagram = document.createElement('div'); diagram.innerHTML = fixture('deepseek', 'format-answer');
  expect(deepseekToMarkdown(diagram, result!.sourceUrl)).toContain('mindmap-ui');
});

test('real Kimi: excludes reasoning, keeps code/tables, preserves every unavailable TeX as a static equation', async () => {
  document.body.innerHTML = fixture('kimi', 'format-answer');
  const original = document.body.innerHTML;
  const result = await extractLatestAnswer(document, 'https://www.kimi.com/chat/format');
  expect(result?.provider).toBe('kimi');
  expect(result?.sourceMessageId).toBe('1a12b50a-eff2-831b-8000-0a6dd591ce45');
  expect(result?.markdown).not.toContain('Need to ensure');
  expect(result?.markdown).not.toContain('No internal reasoning');
  expect(result?.markdown?.match(/```mindmap-ui/g)).toHaveLength(14);
  for (const language of ['javascript', 'python', 'mermaid', 'text']) expect(result?.markdown).toContain('```' + language);
  expect(result?.markdown).toContain('[x] 已完成任务');
  expect(result?.markdown).toContain('[ ] 未完成任务');
  expect(result?.markdown).toContain('a\\|b');
  expect(result?.markdown).toContain('换行<br>第二行');
  expect(result?.markdown).not.toContain('复制');
  expect(document.body.innerHTML).toBe(original);
});

test('Kimi recovers exact source formulas when the native copy output is available', () => {
  const root = document.createElement('div');
  root.innerHTML = '<p>Formula <span class="katex-wrapper">glyph</span></p><span class="katex-wrapper math-display">glyph</span>';
  const raw = String.raw`Formula \(\frac{a}{b}\).\n\[\int_0^1 x\,dx\]`;
  const result = kimiToMarkdown(root, 'https://www.kimi.com/', raw);
  expect(result).toContain('$\\frac{a}{b}$');
  expect(result).toContain('$$\n\\int_0^1 x\\,dx\n$$');
  expect(result).not.toContain('mindmap-ui');
  expect(mathFromMarkdown('```text\n$x$\n```\n`$y$` $z$')).toEqual([{ tex: 'z', display: false }]);
});

test('native copy intercept restores page APIs and never reads/writes the system clipboard', async () => {
  const originalWrite = async () => { throw new Error('system clipboard must stay untouched'); };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: originalWrite } });
  document.body.innerHTML = '<div data-mindmap-copy-target="test"><div class="segment-assistant-actions-content"><div class="icon-button"><svg name="Copy"></svg></div></div></div>';
  document.querySelector('.icon-button')!.addEventListener('click', () => { void navigator.clipboard.writeText(String.raw`Answer $\frac{1}{2}$`); });
  expect(await copyMarkdownInPage('test')).toBe(String.raw`Answer $\frac{1}{2}$`);
  expect(navigator.clipboard.writeText).toBe(originalWrite);
});

test('static snapshots retain SVG and forms but remove active markup and remote CSS', () => {
  const sanitized = sanitizeRichHtml('<script>alert(1)</script><iframe src="https://evil.test"></iframe><svg onload="evil()"><path d="M0 0L10 10" fill="url(#gradient)"></path><foreignObject><div onclick="evil()">Label</div></foreignObject></svg><input value="42" oninput="evil()"><a href="javascript:evil()">Link</a><div style="color:red;background-image:url(https://evil.test);position:fixed">Card</div>');
  expect(sanitized).toContain('<svg'); expect(sanitized).toContain('value="42"'); expect(sanitized).toContain('disabled');
  for (const forbidden of ['script', 'iframe', 'onload', 'onclick', 'href=', 'background-image', 'evil']) expect(sanitized).not.toContain(forbidden);
  expect(readRichSnapshot(JSON.stringify({ html: sanitized, height: 800 }))).toMatchObject({ height: 800 });
  expect(readRichSnapshot('{bad')).toBeNull();
});

test.each(['deepseek', 'kimi'] as const)('%s routes capture, tabs, metadata and safe navigation while rejecting user/streaming turns', async (provider) => {
  const sourceUrl = provider === 'deepseek' ? 'https://chat.deepseek.com/a/chat/s/test' : 'https://www.kimi.com/chat/test';
  const attrs = provider === 'deepseek' ? 'class="ds-message"' : 'class="chat-content-item-assistant"';
  const body = provider === 'deepseek' ? '<div class="ds-assistant-message-main-content">Answer</div>' : '<div class="markdown">Answer</div>';
  document.body.innerHTML = `<div id="user">Question</div><div ${attrs} id="old">${body}</div><div ${attrs} id="new" data-is-streaming="true">${body}</div>`;
  expect(findAssistantMessage(document.querySelector('#user'), sourceUrl)).toBeNull();
  expect(await extractLatestAnswer(document, sourceUrl)).toBeNull();
  expect((await extractAnswerFromTarget(document.querySelector('#old'), sourceUrl))?.markdown).toBe('Answer');
  document.querySelector('#new')!.removeAttribute('data-is-streaming');
  const payload = await extractLatestAnswer(document, sourceUrl);
  expect(capturedAnswerPayloadSchema.parse(payload).provider).toBe(provider);
  expect(aiTabsSchema.parse([{ id: provider, provider }])).toHaveLength(1);
  expect(classifyNavigation(sourceUrl)).toBe('internal');
  expect(classifyNavigation(sourceUrl.replace('.com/', '.com.evil.test/'))).toBe('external');
  expect(() => capturedAnswerPayloadSchema.parse({ ...payload, sourceUrl: 'https://evil.test/' })).toThrow();
  expect(answerDocumentSchema).toBeTruthy();
});
