import { useEffect, useState } from "react";
import { FileText, History, Pencil, Plus, Trash2, Workflow, FolderTree, Unlink } from "lucide-react";

interface NodeContextMenuProps {
  onCreateAttachment?(nodeUid: string, kind: 'blank' | 'import'): void;
  x: number;
  y: number;
  nodeUid: string;
  title: string;
  answerId?: string;
  linkedProjectId?: string;
  onLinkProject?(nodeUid: string, title: string): void;
  onUnlinkProject?(nodeUid: string): void;
  isRoot: boolean;
  initialRename?: boolean;
  onClose(): void;
  onRename(nodeUid: string, title: string): void;
  onCreateChild(nodeUid: string): void;
  onCreateSibling(nodeUid: string): void;
  onMoveToHistory(nodeUid: string): void;
  onDelete(nodeUid: string): void;
  onOpenAnswer(answerId: string, nodeUid: string): void;
  onMerge?(): void;
  canMerge?: boolean;
}

export function NodeContextMenu(props: NodeContextMenuProps): React.JSX.Element {
  const [editing, setEditing] = useState(props.initialRename === true);
  const left = Math.max(6, Math.min(props.x, window.innerWidth - 214));
  const top = Math.max(6, Math.min(props.y, window.innerHeight - 420));
  const { onClose } = props;

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    const onPointer = (event: PointerEvent): void => {
      if (!(event.target as Element | null)?.closest(".node-context-menu")) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, [onClose]);

  const finishRename = (value: string): void => {
    const title = value.trim();
    if (title && title !== props.title) props.onRename(props.nodeUid, title);
    props.onClose();
  };

  return (
    <div
      className="node-context-menu"
      role="menu"
      aria-label="节点操作"
      style={{ left: `${left}px`, top: `${top}px` }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {editing ? (
        <div className="node-context-rename">
          <label htmlFor="node-context-title">节点标题</label>
          <input
            id="node-context-title"
            autoFocus
            aria-label="节点标题"
            defaultValue={props.title}
            maxLength={500}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") finishRename(event.currentTarget.value);
              if (event.key === "Escape") props.onClose();
            }}
          />
        </div>
      ) : (
        <>
          <button role="menuitem" onClick={() => setEditing(true)}><Pencil size={15} />重命名节点标题</button>
          <button role="menuitem" onClick={() => { props.onCreateChild(props.nodeUid); props.onClose(); }}>
            <Plus size={15} />新建子节点
          </button>
          <button role="menuitem" disabled={props.isRoot} onClick={() => { props.onCreateSibling(props.nodeUid); props.onClose(); }}>
            <Workflow size={15} />新建同级节点
          </button>
          {props.answerId && (
            <button role="menuitem" onClick={() => { props.onOpenAnswer(props.answerId!, props.nodeUid); props.onClose(); }}>
              <FileText size={15} />打开关联回答
            </button>
          )}
          {props.onLinkProject && <button role="menuitem" onClick={() => { props.onLinkProject?.(props.nodeUid, props.title); props.onClose(); }}><FolderTree size={15} />关联子项目</button>}
          {props.linkedProjectId && props.onUnlinkProject && <button role="menuitem" onClick={() => { props.onUnlinkProject?.(props.nodeUid); props.onClose(); }}><Unlink size={15} />取消项目关联</button>}
          {props.onCreateAttachment && <><button role="menuitem" onClick={() => { props.onCreateAttachment?.(props.nodeUid, 'blank'); props.onClose(); }}>新增空白文档</button><button role="menuitem" onClick={() => { props.onCreateAttachment?.(props.nodeUid, 'import'); props.onClose(); }}>导入 Markdown 文档</button></>}
          <span className="node-context-separator" />
          {props.onMerge && <button role="menuitem" disabled={!props.canMerge} onClick={() => { props.onMerge?.(); props.onClose(); }}>合并选中节点</button>}
          <button role="menuitem" disabled={props.isRoot} onClick={() => { props.onMoveToHistory(props.nodeUid); props.onClose(); }}>
            <History size={15} />移到历史节点
          </button>
          <button className="danger" role="menuitem" disabled={props.isRoot} onClick={() => { props.onDelete(props.nodeUid); props.onClose(); }}>
            <Trash2 size={15} />删除节点
          </button>
        </>
      )}
    </div>
  );
}
