import { useEffect, useMemo, useRef, useState } from 'react';
import katexStyles from 'katex/dist/katex.min.css?inline';
import { readRichSnapshot } from '../../../shared/rich-answer.js';

export function RichAnswerSnapshot({ value }: { value: string }): React.JSX.Element {
  const snapshot = useMemo(() => readRichSnapshot(value), [value]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [availableWidth, setAvailableWidth] = useState(0);
  useEffect(() => {
    const frame = viewportRef.current;
    if (!frame || snapshot?.formula) return;
    const observer = new ResizeObserver(() => setAvailableWidth(frame.clientWidth));
    observer.observe(frame); setAvailableWidth(frame.clientWidth);
    return () => observer.disconnect();
  }, [snapshot]);
  if (!snapshot) return <pre>{value}</pre>;
  const scale = !snapshot.formula && snapshot.width && availableWidth ? Math.min(1, availableWidth / snapshot.width) : 1;
  const base = document.baseURI.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const srcDoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; font-src file: data: 'self'; form-action 'none'; base-uri file: 'self'"><base href="${base}"><style>${snapshot.formula ? '' : '*{margin:0;padding:0;border-width:0}'}${katexStyles}\nhtml,body{margin:0;padding:0;background:white;color:#20252b;font:15px system-ui}body{padding:${snapshot.formula ? 12 : 10}px;box-sizing:border-box;${!snapshot.formula && snapshot.width ? `width:${snapshot.width}px;` : ''}}${snapshot.formula ? '.katex-display{margin:0;padding:4px 0}' : ''}img,svg{max-width:100%}a{pointer-events:none}button,input,textarea,select{pointer-events:none}.katex-mathml{display:none}*{animation:none!important;transition:none!important}</style></head><body>${snapshot.html}</body></html>`;
  if (snapshot.formula) return <iframe className={snapshot.inline ? 'rich-answer-formula rich-answer-formula--inline' : 'rich-answer-formula'} title="公式网页画面" sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} style={{ height: snapshot.height, width: snapshot.inline ? snapshot.width : '100%' }} />;
  return <details className="rich-answer-snapshot" open>
    <summary>网页画面</summary>
    <div ref={viewportRef} className="rich-answer-snapshot-viewport" style={{ height: snapshot.height * scale }}>
      <iframe title="回答网页画面" sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} style={{ height: snapshot.height, width: snapshot.width ?? '100%', transform: `scale(${scale})`, transformOrigin: 'top left' }} />
    </div>
  </details>;
}
