import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

const samples = [
  { provider: 'chatgpt', name: 'intelligent-ui-answer-styled', url: 'https://chatgpt.com/c/rich-format-fixture', code: 0, math: 0, snapshots: 1 },
  { provider: 'deepseek', name: 'format-answer-code-styled', url: 'https://chat.deepseek.com/a/chat/s/format-fixture', code: 4, math: 12, snapshots: 0 },
  { provider: 'kimi', name: 'format-answer-styled', url: 'https://www.kimi.com/chat/format-fixture', code: 4, math: 0, snapshots: 14 }
] as const;

for (const sample of samples) test(`${sample.provider}: real DOM captures, saves, renders and reopens`, async () => {
  test.setTimeout(120000);
  const root = await mkdtemp(path.join(tmpdir(), 'mindmap-rich-workspace-'));
  const profile = await mkdtemp(path.join(tmpdir(), 'mindmap-rich-profile-'));
  const artifactDir = path.resolve('artifacts/rich-provider-test');
  await mkdir(artifactDir, { recursive: true });
  const application = await electron.launch({ args: ['.', `--user-data-dir=${profile}`] });
  try {
    await application.evaluate(({ dialog }, selectedPath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] }); }, root);
    const page = await application.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('button', { name: '新建工作区', exact: true }).first().click();
    if (sample.provider !== 'chatgpt') await page.getByRole('combobox', { name: '新建问答标签页' }).selectOption(sample.provider);
    const html = await readFile(path.resolve(`tests/fixtures/${sample.provider}/${sample.name}.html`), 'utf8');
    await application.evaluate(async ({ session, webContents }, fixture) => {
      const isolated = session.fromPartition(`persist:provider-${fixture.provider}`);
      await isolated.protocol.handle('https', () => new Response(`<!doctype html><html><meta charset="utf-8"><body>${fixture.html}</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
      const contents = webContents.getAllWebContents().find((entry) => entry.session === isolated)!;
      contents.stop();
        await new Promise((resolve) => setTimeout(resolve, 100));
        await contents.loadURL(fixture.url);
    }, { ...sample, html });
    await expect.poll(() => application.evaluate(async ({ session, webContents }, provider) => {
      const contents = webContents.getAllWebContents().find((entry) => entry.session === session.fromPartition(`persist:provider-${provider}`))!;
      return contents.executeJavaScript("Boolean(document.getElementById('mindmap-ai-hover-style'))") as Promise<boolean>;
    }, sample.provider)).toBe(true);
    await page.getByRole('button', { name: '捕获最新回答' }).click();
    const candidate = page.locator('.node-tray-card');
    await expect(candidate).toHaveCount(1);
    const workspace = JSON.parse(await readFile(path.join(root, 'workspace.json'), 'utf8')) as { activeProjectId: string };
    const project = JSON.parse(await readFile(path.join(root, 'projects', workspace.activeProjectId, 'project.json'), 'utf8')) as { state: { candidates: Array<{ answerId: string; title: string }> } };
    const captured = project.state.candidates[0];
    const answer = await page.evaluate((id) => window.mindmapAI.project.readAnswer(id), captured.answerId);
    expect(answer?.metadata.provider).toBe(sample.provider);
    const saved = await readFile(path.join(root, 'answers', `${captured.answerId}.md`), 'utf8');
    expect(saved.includes(answer!.body)).toBe(true);
    await writeFile(path.join(artifactDir, `${sample.provider}-saved-note.md`), saved);
    await candidate.dragTo(page.locator('.mindmap-canvas .smm-node').first(), { sourcePosition: { x: 12, y: 12 } });
    if (await candidate.isVisible()) await candidate.dragTo(page.locator('.mindmap-canvas .smm-node').first(), { sourcePosition: { x: 12, y: 12 } });
    await expect(candidate).toHaveCount(0);
    await page.locator('.mindmap-canvas .smm-node', { hasText: captured.title }).first().dblclick();
    const reader = page.getByLabel('回答阅读器');
    await expect(reader).toBeVisible();
    const preview = reader.locator('.markdown-preview');
    await expect(preview.locator('pre code')).toHaveCount(sample.code);
    await expect(preview.locator('.katex')).toHaveCount(sample.math);
    await expect(preview.locator('.katex-error')).toHaveCount(0);
    await expect(preview.locator('iframe')).toHaveCount(sample.snapshots);
    expect(await preview.locator('iframe').evaluateAll((frames) => frames.every((frame) => frame.getAttribute('sandbox') === ''))).toBe(true);
    await reader.screenshot({ path: path.join(artifactDir, `${sample.provider}-reader.png`) });
    if (sample.provider === 'chatgpt') {
      const frame = preview.frameLocator('iframe');
      await expect(frame.locator('svg.recharts-surface')).toHaveCount(1);
      await expect(frame.locator('path.recharts-rectangle')).toHaveCount(8);
      await preview.locator('iframe').scrollIntoViewIfNeeded();
      await expect(frame.locator('svg.recharts-surface')).toBeVisible();
      await frame.locator('svg.recharts-surface').scrollIntoViewIfNeeded();
      await writeFile(path.join(artifactDir, 'chatgpt-snapshot-layout.json'), JSON.stringify(await frame.locator('body').evaluate((body) => ({height: body.getBoundingClientRect().height, width: body.getBoundingClientRect().width, style: body.getAttribute('style'), html: body.innerHTML.slice(0,300), chart: body.querySelector('svg.recharts-surface')?.getBoundingClientRect().toJSON()})), null, 2));
      await reader.screenshot({ path: path.join(artifactDir, 'chatgpt-web-snapshot.png') });
    } else {
      await expect(preview.locator('[data-footnote-ref]')).toHaveCount(sample.provider === 'deepseek' ? 2 : 1);
      await expect(preview.locator('td br').first()).toBeAttached();
      await preview.locator('table').first().scrollIntoViewIfNeeded();
      await reader.screenshot({ path: path.join(artifactDir, `${sample.provider}-table.png`) });
      if (sample.provider === 'kimi') {
        for (let index = 0; index < sample.snapshots; index++) {
          const formulaFrame = preview.frameLocator('iframe').nth(index);
          const bounds = await formulaFrame.locator('.katex-html').evaluate(async (html) => {
            await document.fonts.ready;
            const glyphs = [...html.querySelectorAll('span')].filter((glyph) => !glyph.childElementCount && glyph.textContent?.trim()).map((glyph) => glyph.getBoundingClientRect()).filter((rect) => rect.width > 0);
            return { top: Math.min(...glyphs.map((rect) => rect.top)), bottom: Math.max(...glyphs.map((rect) => rect.bottom)), height: innerHeight };
          });
          expect(bounds.top).toBeGreaterThanOrEqual(-1);
          expect(bounds.bottom).toBeLessThanOrEqual(bounds.height + 1);
        }
        const frame = preview.frameLocator('iframe').last();
        await expect(frame.locator('.katex')).toHaveCount(1);
        await preview.locator('iframe').last().scrollIntoViewIfNeeded();
        await reader.screenshot({ path: path.join(artifactDir, 'kimi-math.png') });
      } else {
        await preview.locator('.katex-display').nth(4).scrollIntoViewIfNeeded();
        await reader.screenshot({ path: path.join(artifactDir, 'deepseek-math.png') });
      }
    }
    const report = await preview.evaluate((element) => ({
      headings: [...element.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((heading) => heading.textContent),
      code: [...element.querySelectorAll('pre code')].map((code) => ({ language: code.className, text: code.textContent })),
      formulas: element.querySelectorAll('.katex').length,
      snapshotFormulas: element.querySelectorAll('iframe.rich-answer-formula').length,
      snapshots: element.querySelectorAll('iframe').length,
      tableAlign: [...element.querySelectorAll('th')].map((cell) => getComputedStyle(cell).textAlign),
      tableBreaks: element.querySelectorAll('td br').length,
      tasks: [...element.querySelectorAll('input[type="checkbox"]')].map((checkbox) => (checkbox as HTMLInputElement).checked)
    }));
    expect(errors).toEqual([]);
    await writeFile(path.join(artifactDir, `${sample.provider}-report.json`), JSON.stringify({ provider: sample.provider, source: 'real DOM and computed styles replayed in production sandboxed Electron preload', ...report }, null, 2));
    // Reopen from disk and ensure no snapshot or provider metadata is lost.
    const reread = await page.evaluate((id) => window.mindmapAI.project.readAnswer(id), captured.answerId);
    expect(reread?.body === answer?.body).toBe(true);
  } finally {
    await application.close();
    for (const temporary of [root, profile]) {
      expect(path.resolve(temporary).startsWith(path.resolve(tmpdir()) + path.sep)).toBe(true);
      await rm(temporary, { recursive: true, force: true });
    }
  }
});
