import { FolderOpen, Plus } from "lucide-react";

export function EmptyWorkspace({ onCreate, onOpen }: { onCreate(): void; onOpen(): void }): React.JSX.Element {
  return (
    <main className="empty-workspace">
      <div className="empty-orbit" aria-hidden="true"><span /><span /><span /></div>
      <p className="eyebrow">LOCAL KNOWLEDGE WORKSPACE</p>
      <h1>让一次 AI 回答，<br />成为可继续生长的思路。</h1>
      <p className="empty-copy">回答保存在本地 Markdown 中，再拖进思维导图形成可追溯的知识节点。</p>
      <div className="empty-actions">
        <button className="primary" onClick={onCreate}><Plus size={18} />新建工作区</button>
        <button onClick={onOpen}><FolderOpen size={18} />打开工作区</button>
      </div>
      <div className="empty-steps">
        <span>01 · 在右侧选择平台并对话</span>
        <span>02 · 捕获回答到候选托盘</span>
        <span>03 · 拖进导图继续组织</span>
      </div>
    </main>
  );
}
