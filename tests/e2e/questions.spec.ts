import { _electron as electron, expect, test } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WorkspaceStore } from '../../src/main/workspace-store.js';
import { contentHash } from '../../src/shared/content.js';
import { DEFAULT_CONCEPT_SETTINGS, type ConceptRecord } from '../../src/shared/concepts.js';
import type { ProviderId } from '../../src/shared/types.js';

const urls = { chatgpt: 'https://chatgpt.com/c/source', yuanbao: 'https://yuanbao.tencent.com/chat/source', doubao: 'https://www.doubao.com/chat/source', deepseek: 'https://chat.deepseek.com/a/chat/s/source', kimi: 'https://www.kimi.com/chat/source' };
function fixture(provider: ProviderId): string {
  const editor = {
    chatgpt: '<textarea id="prompt-textarea"></textarea><button data-testid="send-button">发送</button>',
    yuanbao: '<div class="ql-editor" contenteditable="true"></div><div id="yuanbao-send-btn" role="button">发送</div>',
    doubao: '<div class="tiptap ProseMirror" contenteditable="true"></div><button data-testid="chat_input_send_button">发送</button>',
    deepseek: '<textarea placeholder="给 DeepSeek 发送消息"></textarea><div role="button" class="ds-button--primary ds-button--circle">发送</div>',
    kimi: '<div class="chat-input-editor" contenteditable="true"></div><div class="send-button-container" role="button">发送</div>'
  }[provider];
  const message = (id: string, body: string): string => ({
    chatgpt: `<article data-content-search-unit-key="${id}"><div data-conversation-role="assistant"><div class="markdown">${body}</div></div></article>`,
    yuanbao: `<div class="agent-chat__bubble--ai" data-message-id="${id}"><div class="agent-chat__bubble__content">${body}</div></div>`,
    doubao: `<div data-testid="receive_message"><div data-testid="message_content" data-message-id="${id}"><div data-testid="message_text_content">${body}</div></div></div>`,
    deepseek: `<div class="ds-message" data-message-id="${id}"><div class="ds-assistant-message-main-content">${body}</div></div>`,
    kimi: `<div class="chat-content-item-assistant" data-archer-id="${id}"><div class="segment-assistant"><div class="segment-content-box">${body}</div></div></div>`
  })[provider];
  const answer = '<h2>答疑回答</h2><p>带截距的最小二乘回归使残差之和为零。</p><ul><li>用例子验证</li></ul><table><thead><tr><th>模型</th><th>残差和</th></tr></thead><tbody><tr><td>带截距</td><td>0</td></tr></tbody></table><pre><code class="language-python">sum(residuals)</code></pre>';
  return `<!doctype html><html><meta charset="utf-8"><style>body{font:16px system-ui;padding:30px}textarea{width:400px;height:100px}p{line-height:2}</style><body>${editor}${message('source', '<h1>回归模型</h1><p>模型 <code>y=x</code> 中残差是观测值与预测值之差。</p><p>' + '跨段落答疑需要完整保留这段上下文。'.repeat(15) + '</p>')}<script>
  document.querySelector('button,[role=button]').addEventListener('click',()=>{
    const input=document.querySelector('textarea,[contenteditable]');document.body.dataset.sentPrompt=input.value??input.textContent;
    const wrapper=document.createElement('section');wrapper.innerHTML=${JSON.stringify(message('generated', answer))};document.body.append(wrapper);
  });</script></body></html>`;
}

for (const provider of ['chatgpt', 'yuanbao', 'doubao', 'deepseek', 'kimi'] as const) test(`${provider}: in-place marks and editable questions persist as annotations without nodes`, async () => {
  test.setTimeout(90000);
  const root = await mkdtemp(path.join(tmpdir(), 'mindmap-questions-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'mindmap-questions-profile-'));
  const artifactDir = path.resolve('artifacts/question-annotations'); await mkdir(artifactDir, { recursive: true });
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    const store = new WorkspaceStore(root); const initial = await store.initialize('答疑验收', '回归模型');
    const now = new Date().toISOString();
    const body = '# 回归模型\n\n模型 `y=x` 中残差是观测值与预测值之差。\n\n' + Array.from({ length: 8 }, (_, index) => `## 其他段落 ${index}\n\n用于检验滚动和窗口布局。`).join('\n\n');
    const selection = { text: '残差', sentence: '模型  中残差是观测值与预测值之差。', prefix: '模型  中', suffix: '是观测值与预测值之差。' };
    await store.answers.write({ metadata: { id: 'source', title: '回归模型', provider, sourceUrl: urls[provider], sourceMessageId: 'source', contentHash: await contentHash(body), capturedAt: now, updatedAt: now }, body });
    const id = randomUUID(); const concept: ConceptRecord = { id, answerId: `concept-${id}`, title: '残差', provider, status: 'ready', prompt: '', tabId: `concept-tab-${id}`, createdAt: now,
      references: [{ sourceAnswerId: 'source', sourceTitle: '回归模型', selection, sourceUrl: urls[provider], sourceMessageId: 'source', projectId: initial.project.manifest.projectId }] };
    await store.answers.write({ metadata: { id: concept.answerId, conceptId: id, title: '残差', provider, sourceUrl: urls[provider], sourceMessageId: 'concept', contentHash: await contentHash('残差概念解释。'), capturedAt: now, updatedAt: now }, body: '残差概念解释。' });
    await writeFile(path.join(root, 'concepts.json'), JSON.stringify({ settings: { ...DEFAULT_CONCEPT_SETTINGS, background: true }, records: [concept] }));
    await store.saveActive({ ...initial.project, mindmap: { uid: 'root', text: '答疑验收', children: [{ uid: 'source-node', text: '回归模型', answerId: 'source', children: [] }] } });
    application = await electron.launch({ args: ['.', `--user-data-dir=${profile}`] });
    await application.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); }, root);
    let page = await application.firstWindow(); const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: '打开工作区', exact: true }).first().click();
    if (provider !== 'chatgpt') await page.getByRole('combobox', { name: '新建问答标签页' }).selectOption(provider);
    await application.evaluate(async ({ session, webContents }, sample) => {
      const isolated = session.fromPartition(`persist:provider-${sample.provider}`);
      await isolated.protocol.handle('https', () => new Response(sample.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      const contents = webContents.getAllWebContents().find((entry) => entry.session === isolated)!;
      contents.stop(); await new Promise((resolve) => setTimeout(resolve, 100)); await contents.loadURL(sample.url);
    }, { provider, url: urls[provider], html: fixture(provider) });
    await page.locator('.mindmap-canvas .smm-node', { hasText: '回归模型' }).dblclick();
    let reader = page.getByLabel('回答阅读器');
    let preview = reader.locator('[data-answer-id="source"] > .answer-content > .markdown-preview');
    const mark = () => reader.getByRole('button', { name: '打开概念：残差', exact: true });
    await expect(mark()).toBeVisible();
    const aligned = async (): Promise<number> => preview.evaluate((element) => {
      const node = element.querySelector('p')!.lastChild!; const range = document.createRange(); const index = node.textContent!.indexOf('残差'); range.setStart(node, index); range.setEnd(node, index + 2);
      const text = range.getBoundingClientRect(); const chip = element.querySelector('[aria-label="打开概念：残差"]')!.getBoundingClientRect();
      return Math.abs(chip.left - text.left + 2) + Math.abs(chip.top - text.top + 1);
    });
    await expect.poll(aligned).toBeLessThan(2);
    await reader.getByRole('button', { name: '收起概念侧栏' }).click(); await expect.poll(aligned).toBeLessThan(2);
    await reader.getByRole('button', { name: '最大化窗口' }).click(); await expect.poll(aligned).toBeLessThan(2);
    await preview.evaluate((element) => { element.scrollTop = 36; }); await expect.poll(aligned).toBeLessThan(2);
    await preview.evaluate((element) => { element.scrollTop = 0; });
    await reader.getByRole('button', { name: '还原窗口' }).click();
    await preview.locator('p').first().evaluate((element) => {
      const node = element.lastChild!; const index = node.textContent!.indexOf('残差'); const range = document.createRange(); range.setStart(node, index); range.setEnd(node, index + 2);
      const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    });
    await reader.getByRole('button', { name: '答疑：残差', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '对原文提问' });
    await expect(dialog.getByLabel('自定义问题')).toHaveValue(/当前主题.*回归模型/);
    const question = '为什么这个模型的残差和为零？请比较带截距与不带截距的情况。';
    await dialog.getByLabel('自定义问题').fill(question);
    await dialog.screenshot({ path: path.join(artifactDir, `${provider}-question-dialog.png`) });
    await dialog.getByRole('button', { name: '发送问题' }).click(); await expect(dialog).not.toBeVisible();
    await expect(reader.getByRole('button', { name: '答疑生成中：残差', exact: true })).toBeVisible();
    await expect.poll(async () => (await page.evaluate(() => window.mindmapAI.concepts.get())).records.find((record) => record.kind === 'qa')?.status).toBe('ready');
    const qa = (await page.evaluate(() => window.mindmapAI.concepts.get())).records.find((record) => record.kind === 'qa')!;
    expect(qa.prompt).toBe(question);
    await expect(page.locator('.concept-node-card')).toHaveCount(1);
    await expect(page.locator('.mindmap-canvas .smm-node')).toHaveCount(2);
    await reader.getByRole('button', { name: '打开答疑：残差', exact: true }).click();
    const annotation = reader.getByLabel('答疑批注', { exact: true });
    await expect(annotation).toContainText('带截距的最小二乘回归使残差之和为零。');
    await expect(annotation.locator('table')).toHaveCount(1); await expect(annotation.locator('pre code')).toHaveCount(1);
    await annotation.getByText('我的问题', { exact: true }).click(); await expect(annotation).toContainText(question);
    await reader.screenshot({ path: path.join(artifactDir, `${provider}-annotation.png`) });
    const note = await page.evaluate((id) => window.mindmapAI.project.readAnswer(id), qa.answerId);
    expect(note?.metadata.annotationId).toBe(qa.id); expect(note?.metadata.conceptId).toBeUndefined();
    await writeFile(path.join(artifactDir, `${provider}-annotation.md`), await readFile(path.join(root, 'answers', `${qa.answerId}.md`), 'utf8'));
    await annotation.getByRole('button', { name: /定位原文/ }).click();
    await expect(mark()).toBeVisible();
    await reader.getByRole('button', { name: '关闭阅读窗口' }).click();
    // Exercise the sandboxed website preload, including the new ChatGPT wrapper.
    await application.evaluate(async ({ session, webContents }, provider) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.session === session.fromPartition(`persist:provider-${provider}`))!;
      await contents.executeJavaScript(`(() => {
        const paragraph = document.querySelector('p'); const node = paragraph.lastChild; const index = node.textContent.indexOf('观测值');
        const next = paragraph.nextElementSibling.firstChild;
        const range = document.createRange(); range.setStart(node,index); range.setEnd(next,next.textContent.length);
        document.getSelection().removeAllRanges(); document.getSelection().addRange(range);
        paragraph.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,button:0}));
        document.querySelector('.selection-ask-button').click();
      })()`);
    }, provider);
    const webDialog = page.getByRole('dialog', { name: '对原文提问' });
    await expect(webDialog).toBeVisible(); await expect(webDialog).toContainText('观测值');
    await webDialog.getByLabel('自定义问题').fill('观测值与预测值有什么区别？');
    await webDialog.getByRole('button', { name: '发送问题' }).click();
    await expect.poll(async () => (await page.evaluate(() => window.mindmapAI.concepts.get())).records.filter((record) => record.kind === 'qa' && record.status === 'ready').length).toBe(2);
    const longQuestion = (await page.evaluate(() => window.mindmapAI.concepts.get())).records.filter((record) => record.kind === 'qa')[1]!;
    expect(longQuestion.references[0]!.selection.text.length).toBeGreaterThan(160);
    expect(longQuestion.references[0]!.selection.text).toContain('跨段落答疑');
    await expect(page.locator('.concept-node-card')).toHaveCount(1);
    await expect.poll(() => application!.evaluate(async ({ session, webContents }, provider) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.session === session.fromPartition(`persist:provider-${provider}`))!;
      return contents.executeJavaScript(`Boolean(document.querySelector('[aria-label^="打开答疑：观测值"]'))`) as Promise<boolean>;
    }, provider)).toBe(true);
    await application.evaluate(async ({ session, webContents }, provider) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.session === session.fromPartition(`persist:provider-${provider}`))!;
      await contents.executeJavaScript(`document.querySelector('[aria-label^="打开答疑：观测值"]').click()`);
    }, provider);
    await expect(page.locator('.question-backdrop').getByLabel('答疑批注', { exact: true })).toContainText('带截距的最小二乘回归使残差之和为零。');
    await page.getByRole('button', { name: '关闭答疑批注' }).click();
    expect(errors).toEqual([]);
    await application.close();
    application = await electron.launch({ args: ['.', `--user-data-dir=${profile}`] }); page = await application.firstWindow();
    await expect(page.locator('.mindmap-canvas .smm-node', { hasText: '回归模型' })).toBeVisible();
    await page.locator('.mindmap-canvas .smm-node', { hasText: '回归模型' }).dblclick(); reader = page.getByLabel('回答阅读器'); preview = reader.locator('[data-answer-id="source"] > .answer-content > .markdown-preview');
    await expect(mark()).toBeVisible(); await expect.poll(aligned).toBeLessThan(2);
    await reader.getByRole('button', { name: '打开答疑：残差', exact: true }).click();
    await expect(reader.getByLabel('答疑批注', { exact: true })).toContainText('带截距的最小二乘回归使残差之和为零。');
    await expect(page.locator('.concept-node-card')).toHaveCount(1);
  } finally { await application?.close(); await rm(root, { recursive: true, force: true }); await rm(profile, { recursive: true, force: true }); }
});
