// Portable, inert snapshots. Both capture and rendering use the same allowlist;
// saved notes are untrusted even when they were produced by this application.
const TAGS = new Set(('div span p section article header footer h1 h2 h3 h4 h5 h6 strong em b i u s del blockquote pre code ul ol li table thead tbody tfoot tr th td br hr a img label input textarea select option button details summary figure figcaption svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask marker title desc foreignObject').toLowerCase().split(' '));
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base']);
const ATTRS = new Set(('id title alt role aria-label aria-hidden hidden dir colspan rowspan start checked selected disabled type value min max step viewBox width height x y x1 y1 x2 y2 cx cy r rx ry d points transform fill stroke stroke-width stroke-dasharray stroke-linecap stroke-linejoin opacity fill-opacity stroke-opacity fill-rule clip-rule clip-path mask offset stop-color stop-opacity text-anchor dominant-baseline font-size font-family preserveAspectRatio marker-start marker-mid marker-end markerWidth markerHeight markerUnits refX refY orient gradientUnits gradientTransform').toLowerCase().split(' '));
const STYLES = ('display flex-direction flex-wrap flex-grow flex-shrink flex-basis align-items align-self justify-content gap row-gap column-gap grid-template-columns grid-template-rows grid-column grid-row color background-color font-family font-size font-weight font-style line-height letter-spacing text-align text-decoration white-space word-break overflow-wrap vertical-align padding-top padding-right padding-bottom padding-left margin-top margin-right margin-bottom margin-left border-top-width border-right-width border-bottom-width border-left-width border-style border-color border-radius box-shadow box-sizing width height min-width min-height max-width max-height overflow overflow-x overflow-y position top right bottom left transform transform-origin opacity fill stroke stroke-width stroke-dasharray').split(' ');
const STYLE_SET = new Set(STYLES);
for (const shorthand of ['padding', 'margin', 'border', 'border-width', 'flex', 'flex-flow', 'inset', 'font', 'background']) STYLE_SET.add(shorthand);
const INHERITED = new Set('color font-family font-size font-weight font-style line-height letter-spacing text-align white-space word-break overflow-wrap fill stroke'.split(' '));

function safeCss(value: string): boolean {
  return !/[<>\\]|url\s*\(|expression\s*\(|@import|javascript:/i.test(value);
}

export function sanitizeRichHtml(html: string, documentRef: Document = document): string {
  const template = documentRef.createElement('template');
  template.innerHTML = html;
  for (const element of [...template.content.querySelectorAll('*')]) {
    const tag = element.localName.toLowerCase();
    if (DROP.has(tag)) { element.remove(); continue; }
    if (!TAGS.has(tag)) { element.replaceWith(...element.childNodes); continue; }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name === 'class' && /^[\w\s-]*$/.test(attribute.value)) continue;
      if (name === 'style') {
        const style = (element as HTMLElement).style;
        for (const property of Array.from({ length: style.length }, (_, index) => style.item(index))) {
          if (!STYLE_SET.has(property) || !safeCss(style.getPropertyValue(property))) style.removeProperty(property);
        }
      } else if (name === 'src' && tag === 'img') {
        if (!/^https:\/\//i.test(attribute.value) && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(attribute.value)) element.removeAttribute(attribute.name);
      } else if (!ATTRS.has(name) || (/url\s*\(/i.test(attribute.value) && !/^url\(#[\w-]+\)$/.test(attribute.value))) {
        element.removeAttribute(attribute.name);
      }
    }
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button') element.setAttribute('disabled', '');
  }
  return template.innerHTML;
}

export interface RichSnapshot { html: string; height: number; formula?: boolean; inline?: boolean; width?: number }

export function captureRichSnapshot(root: Element): RichSnapshot {
  const clone = root.cloneNode(true) as Element;
  const originals = [root, ...root.querySelectorAll('*')];
  const copies = [clone, ...clone.querySelectorAll('*')];
  const view = root.ownerDocument.defaultView;
  const rect = root.getBoundingClientRect();
  const formula = root.matches('.katex-wrapper');
  originals.forEach((source, index) => {
    const target = copies[index] as HTMLElement;
    if (source instanceof HTMLCanvasElement) {
      try {
        const image = root.ownerDocument.createElement('img');
        image.src = source.toDataURL('image/png'); image.alt = source.getAttribute('aria-label') ?? '图形';
        image.width = source.width; image.height = source.height;
        target.replaceWith(image);
      } catch { target.textContent = source.getAttribute('aria-label') ?? '图形无法截取，请查看原页面'; }
      return;
    }
    if (!target.style) return;
    // KaTeX already carries its precise relative offsets inline. Replacing
    // them with computed pixel dimensions breaks fractions and matrices.
    const computed = !formula && rect.width > 0 ? view?.getComputedStyle(source) : undefined;
    const parentStyle = source.parentElement ? view?.getComputedStyle(source.parentElement) : null;
    if (computed) {
      target.removeAttribute('style');
      for (const property of STYLES) {
        const value = computed.getPropertyValue(property);
        if (source !== root && INHERITED.has(property) && value === parentStyle?.getPropertyValue(property)) continue;
        if (value && safeCss(value)) target.style.setProperty(property, value);
      }
      // Page-positioned controls must remain inside the captured card.
      if (computed.position === 'fixed' || computed.position === 'sticky') target.style.position = 'static';
    }
    if (source instanceof HTMLInputElement) {
      target.setAttribute('value', source.value);
      target.toggleAttribute('checked', source.checked);
    } else if (source instanceof HTMLTextAreaElement) target.textContent = source.value;
    else if (source instanceof HTMLOptionElement) target.toggleAttribute('selected', source.selected);
  });
  (clone as HTMLElement).style.maxWidth = '100%';
  (clone as HTMLElement).style.height = 'auto';
  if (formula && view) {
    const computed = view.getComputedStyle(root);
    // Preserve only the formula's inherited typography, keeping KaTeX's own
    // descendant styles in relative units.
    for (const property of ['font-size', 'line-height', 'color']) {
      const value = computed.getPropertyValue(property);
      if (value && safeCss(value)) (clone as HTMLElement).style.setProperty(property, value);
    }
  }
  clone.querySelectorAll('.turn-action-controls, .segment-assistant-actions, .agent-chat__toolbar, .sr-only[data-conversation-role], button:not([data-d-component="button"])').forEach((element) => element.remove());
  // Bundled KaTeX fonts can have taller glyph bounds than the website fonts.
  return { html: sanitizeRichHtml(clone.outerHTML, root.ownerDocument), height: Math.max(formula ? 48 : 120, Math.min(20000, Math.ceil(rect.height) + (formula ? 40 : 24))),
    width: Math.max(32, Math.min(10000, Math.ceil(rect.width) + (formula ? 32 : 20))),
    ...(formula ? { formula: true, inline: !root.classList.contains('math-display') } : {}) };
}

export function snapshotMarkdown(snapshot: RichSnapshot): string {
  const json = JSON.stringify(snapshot);
  const fence = '`'.repeat(Math.max(3, ...[...json.matchAll(/`+/g)].map((match) => match[0].length + 1)));
  return `${fence}mindmap-ui\n${json}\n${fence}`;
}

export function readRichSnapshot(value: string): RichSnapshot | null {
  try {
    const snapshot: unknown = JSON.parse(value);
    if (!snapshot || typeof snapshot !== 'object' || !('html' in snapshot) || typeof snapshot.html !== 'string' || snapshot.html.length > 5_000_000 || !('height' in snapshot) || typeof snapshot.height !== 'number' || !Number.isFinite(snapshot.height)) return null;
    const formula = 'formula' in snapshot && snapshot.formula === true;
    return { html: sanitizeRichHtml(snapshot.html), height: Math.max(formula ? 32 : 120, Math.min(20000, snapshot.height)),
      width: 'width' in snapshot && typeof snapshot.width === 'number' && Number.isFinite(snapshot.width) ? Math.max(32, Math.min(10000, snapshot.width)) : undefined,
      ...(formula ? { formula: true, inline: 'inline' in snapshot && snapshot.inline === true } : {}) };
  } catch { return null; }
}
