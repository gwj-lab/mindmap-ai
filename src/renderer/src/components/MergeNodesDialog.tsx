import { useState } from 'react';
import type { MindMapNodeData } from '../../../shared/types.js';

export function MergeNodesDialog({ nodes, onMerge, onClose }: { nodes: MindMapNodeData[]; onMerge(targetUid: string, title: string, answerId?: string): void; onClose(): void }): React.JSX.Element {
  const [targetUid, setTargetUid] = useState(nodes[0]!.uid);
  const [title, setTitle] = useState(() => nodes.map((node) => node.text).join(' / ').slice(0, 500));
  const [answerId, setAnswerId] = useState(nodes.find((node) => node.answerId)?.answerId ?? '');
  const documents = nodes.filter((node, index) => node.answerId && nodes.findIndex((other) => other.answerId === node.answerId) === index);
  return <div className="dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <form className="merge-nodes-dialog" role="dialog" aria-modal="true" aria-label="合并节点" onKeyDown={(event) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } }} onSubmit={(event) => { event.preventDefault(); if (title.trim()) onMerge(targetUid, title.trim(), answerId || undefined); }}>
      <header><h2>合并 {nodes.length} 个节点</h2><button type="button" aria-label="关闭合并窗口" onClick={onClose}>×</button></header>
      <label>保留节点位置<select aria-label="保留节点位置" value={targetUid} onChange={(event) => setTargetUid(event.target.value)}>{nodes.map((node) => <option key={node.uid} value={node.uid}>{node.text}</option>)}</select></label>
      <label>合并后的标题<input aria-label="合并后的标题" autoFocus maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>保留的附加文档<select aria-label="保留的附加文档" value={answerId} onChange={(event) => setAnswerId(event.target.value)}><option value="">不附加文档</option>{documents.map((node) => <option key={node.answerId} value={node.answerId}>{node.text}</option>)}</select></label>
      <p>合并后最多附加一篇文档。所有子节点会保留，其他文档文件仍可访问。保留节点的位置和项目关联不变。</p>
      <footer><button type="button" onClick={onClose}>取消</button><button type="submit" disabled={!title.trim()}>合并节点</button></footer>
    </form>
  </div>;
}
