import { _electron as electron, expect, test } from "@playwright/test";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("development preview preserves KaTeX layout styles without clipping", async () => {
  const body = String.raw`## Beta 分布与 Gamma 函数

$$B(\alpha,\beta)=\frac{\Gamma(\alpha)\Gamma(\beta)}{\Gamma(\alpha+\beta)}$$

$$B(\alpha,\beta)=\frac{(\alpha-1)!(\beta-1)!}{(\alpha+\beta-1)!}$$

$$\binom{n}{m}=\frac{n!}{m!(n-m)!}$$

$$\text{Beta 分布就是把一个自然描述成功与失败权重的函数，经过归一化后得到的概率分布。}$$`;
  const server = await createServer({
    configFile: false,
    root: path.resolve("src/renderer"),
    // Exercise Vite's development CJS interop, which production builds do not.
    optimizeDeps: { force: true },
    plugins: [react(), {
      name: "math-preview-test",
      resolveId: (id) => id === "virtual:math-preview-test" ? "\0math-preview-test" : null,
      load: (id) => id === "\0math-preview-test" ? `
        import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {MarkdownPreview} from '/src/components/MarkdownPreview.tsx';
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;inset:0;z-index:999;background:white;overflow:auto';
        document.body.appendChild(host);
        createRoot(host).render(React.createElement(MarkdownPreview, {body:${JSON.stringify(body)}}));
      ` : null
    }],
    server: { host: "127.0.0.1", port: 0 }
  });
  const userDataDir = await mkdtemp(path.join(tmpdir(), "mindmap-math-dev-"));
  if (path.dirname(userDataDir) !== tmpdir() || !path.basename(userDataDir).startsWith("mindmap-math-dev-")) {
    throw new Error("Unexpected test user-data path");
  }
  let application: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    await server.listen();
    const url = server.resolvedUrls!.local[0];
    application = await electron.launch({
      args: [".", `--user-data-dir=${userDataDir}`],
      env: { ...process.env, ELECTRON_RENDERER_URL: url }
    });
    const page = await application.firstWindow();
    await page.waitForURL(url);
    await page.locator(".app-shell").waitFor();
    await page.evaluate(async () => {
      const fixtureUrl = "/@id/__x00__math-preview-test";
      await import(/* @vite-ignore */ fixtureUrl);
    });
    await expect(page.locator(".katex-display")).toHaveCount(4);
    const layouts = await page.locator(".katex-display").evaluateAll(async (blocks) => {
      await document.fonts.ready;
      return blocks.map((block) => {
        const bounds = block.getBoundingClientRect();
        const glyphs = [...block.querySelectorAll(".katex-html .mord, .katex-html .mop, .frac-line")]
          .filter((glyph) => !glyph.childElementCount).map((glyph) => glyph.getBoundingClientRect());
        return {
          strutHeight: block.querySelector(".katex-strut")!.getBoundingClientRect().height,
          topClipped: Math.max(0, bounds.top - Math.min(...glyphs.map((glyph) => glyph.top))),
          bottomClipped: Math.max(0, Math.max(...glyphs.map((glyph) => glyph.bottom)) - bounds.bottom)
        };
      });
    });
    for (const layout of layouts) {
      expect(layout.strutHeight).toBeGreaterThan(0);
      expect(layout.topClipped).toBeLessThanOrEqual(1);
      expect(layout.bottomClipped).toBeLessThanOrEqual(1);
    }
    await page.screenshot({ path: "test-results/dev-beta-math.png" });
  } finally {
    await application?.close();
    await server.close();
    // mkdtemp creates this exact directory beneath the system temp directory.
    await rm(userDataDir, { recursive: true, force: true });
  }
});
