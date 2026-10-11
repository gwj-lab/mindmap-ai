import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { collectSearchNodes, matchesSearch, searchTerms, type NodeSearchResult } from '../../../shared/search.js';
import type { ActiveProjectSnapshot } from '../../../shared/types.js';

export function NodeSearch({ snapshot, workspaceId, onSelect }: { snapshot: ActiveProjectSnapshot; workspaceId: string; onSelect(result: NodeSearchResult): void }): React.JSX.Element {
  const [query, setQuery] = useState(''); const [includeContent, setIncludeContent] = useState(false);
  const [remote, setRemote] = useState<NodeSearchResult[]>([]); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false); const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null); const containerRef = useRef<HTMLDivElement>(null);
  const local = useMemo(() => collectSearchNodes(snapshot.mindmap, snapshot.manifest.projectId, snapshot.manifest.name), [snapshot.mindmap, snapshot.manifest.projectId, snapshot.manifest.name]);
  const results = useMemo(() => {
    const terms = searchTerms(query);
    const titles = local.filter((node) => matchesSearch(node.title, terms));
    const current = new Map(local.map((node) => [node.nodeUid, node]));
    const others = remote.flatMap((result) => {
      if (result.projectId !== snapshot.manifest.projectId) return [result];
      const latest = current.get(result.nodeUid);
      return latest && result.snippet && !matchesSearch(latest.title, terms) ? [{ ...latest, snippet: result.snippet }] : [];
    });
    return [...titles, ...others].slice(0, 50);
  }, [local, remote, query, snapshot.manifest.projectId]);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (!query.trim()) { setRemote([]); setLoading(false); return; }
      setLoading(true); setError('');
      void window.mindmapAI.search.query(query, includeContent).then((items) => { if (active) { setRemote(items); setLoading(false); } }).catch((cause: unknown) => { if (active) { setError(cause instanceof Error ? cause.message : '搜索失败'); setLoading(false); } });
    }, 150);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, includeContent, workspaceId, snapshot]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && !event.defaultPrevented) { event.preventDefault(); inputRef.current?.focus(); setOpen(true); } };
    const onPointer = (event: PointerEvent): void => { if (!containerRef.current?.contains(event.target as Node)) setOpen(false); };
    window.addEventListener('keydown', onKey); document.addEventListener('pointerdown', onPointer);
    return () => { window.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer); };
  }, []);
  const choose = (result: NodeSearchResult): void => { onSelect(result); setOpen(false); inputRef.current?.blur(); };
  return <div ref={containerRef} className="node-search" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); }
    if (!open || !results.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected((value) => (value + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length); }
    if (event.key === 'Enter' && event.target === inputRef.current) { event.preventDefault(); choose(results[Math.min(selected, results.length - 1)]!); }
  }}>
    <Search size={16} /><input ref={inputRef} aria-label="搜索节点" placeholder="搜索节点 · Ctrl+F" value={query} maxLength={200} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setRemote([]); setSelected(0); setOpen(true); }} />
    {query && <button aria-label="清空搜索" onClick={() => { setQuery(''); setRemote([]); inputRef.current?.focus(); }}><X size={14} /></button>}
    {open && <div className="node-search-dropdown"><label><input type="checkbox" checked={includeContent} onChange={(event) => { setIncludeContent(event.target.checked); setRemote([]); }} />同时搜索附加文档正文</label>
      {query.trim() ? <><div className="node-search-status" role="status">{error || (loading ? '正在搜索…' : `${results.length} 个结果${results.length === 50 ? '（最多显示 50 个）' : ''}`)}</div>
      <div role="listbox" aria-label="搜索结果">{results.map((result, index) => <button key={`${result.projectId}:${result.nodeUid}`} role="option" aria-selected={selected === index} onClick={() => choose(result)}><strong>{result.title || '未命名节点'}</strong><small>{result.projectName}</small>{result.snippet && <span>{result.snippet}</span>}</button>)}</div></> : <p>输入标题关键词；可勾选正文搜索。</p>}
    </div>}
  </div>;
}
