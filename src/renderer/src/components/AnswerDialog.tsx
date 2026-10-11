import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, Minimize2, PanelRightClose, PanelRightOpen, X } from "lucide-react";
import type { ConceptRecord, ConceptRequest, ConceptSelection } from "../../../shared/concepts.js";
import { AnswerPane } from "./AnswerPane.js";
import { ConceptSidebar } from "./ConceptSidebar.js";

interface AnswerDialogProps {
  nodeTitle?: string;
  records?: ConceptRecord[];
  focusSelection?: ConceptSelection;
  onGenerateConcept?(request: ConceptRequest): Promise<void>;
  onAskQuestion?(request: ConceptRequest): void;
  onRetryQuestion?(id: string): void;
  onOpenNote?(answerId: string, selection?: ConceptSelection): void;
  answerId: string;
  nodeUid: string;
  readOnly?: boolean;
  initialPosition?: { x: number; y: number };
  zIndex?: number;
  active?: boolean;
  hidden?: boolean;
  onActivate?(): void;
  onClose(): void;
  onRetitle(nodeUid: string, title: string): void;
}

export const AnswerDialog = memo(function AnswerDialog(props: AnswerDialogProps): React.JSX.Element {
  const { answerId: sourceAnswerId, records, onOpenNote } = props;
  const [maximized, setMaximized] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedConcept, setSelectedConcept] = useState<string | null>(null);
  const [fullConcept, setFullConcept] = useState<string | null>(null);
  const [visitedConcepts, setVisitedConcepts] = useState<string[]>([]);
  const [sourceFocus, setSourceFocus] = useState<ConceptSelection | undefined>();
  const [position, setPosition] = useState(props.initialPosition ?? { x: 48, y: 76 });
  const windowRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const dirtyDocuments = useRef(new Set<string>());
  const related = (props.records ?? []).filter((record) => record.kind !== "qa" && record.status !== "trash" && record.answerId !== props.answerId && (record.references.some((ref) => ref.sourceAnswerId === props.answerId) || record.answerId === selectedConcept || visitedConcepts.includes(record.answerId)));
  const active = props.active !== false && !props.hidden;
  const onDirtyChange = useCallback((answerId: string, dirty: boolean): void => {
    if (dirty) dirtyDocuments.current.add(answerId); else dirtyDocuments.current.delete(answerId);
  }, []);
  const openFullConcept = useCallback((answerId: string): void => {
    setSelectedConcept(answerId); setFullConcept(answerId);
    setVisitedConcepts((current) => current.includes(answerId) ? current : [...current, answerId]);
  }, []);
  const openNote = useCallback((answerId: string, selection?: ConceptSelection): void => {
    if (answerId === sourceAnswerId) { setFullConcept(null); if (selection) setSourceFocus({ ...selection }); return; }
    const concept = records?.find((record) => record.kind !== "qa" && record.answerId === answerId && record.status !== "trash");
    if (concept) { setSelectedConcept(answerId); setSidebarOpen(true); }
    else onOpenNote?.(answerId, selection);
  }, [sourceAnswerId, records, onOpenNote]);
  const toggleMaximize = useCallback(() => { dragRef.current = null; setMaximized((value) => !value); }, []);
  const startDrag = useCallback((event: ReactPointerEvent<HTMLElement>): void => {
    if (maximized || event.button !== 0 || (event.target as Element).closest("button")) return;
    dragRef.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, [maximized, position]);

  useEffect(() => {
    const move = (event: PointerEvent): void => {
      const drag = dragRef.current;
      const element = windowRef.current;
      if (!drag || !element) return;
      const x = Math.max(0, Math.min(window.innerWidth - Math.min(element.offsetWidth, 180), drag.left + event.clientX - drag.x));
      const y = Math.max(52, Math.min(window.innerHeight - 100, drag.top + event.clientY - drag.y));
      // Text and marks move together, without a React render on every pointer move.
      element.style.left = `${x}px`; element.style.top = `${y}px`;
    };
    const up = (): void => {
      if (dragRef.current && windowRef.current) setPosition({ x: parseFloat(windowRef.current.style.left), y: parseFloat(windowRef.current.style.top) });
      dragRef.current = null;
    };
    const resize = (): void => {
      if (maximized) return;
      setPosition((current) => ({ x: Math.max(0, Math.min(current.x, window.innerWidth - 180)), y: Math.max(52, Math.min(current.y, window.innerHeight - 100)) }));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); window.removeEventListener("resize", resize); };
  }, [maximized]);

  const close = (): void => {
    if (dirtyDocuments.current.size && !window.confirm("窗口中还有未保存的修改。放弃这些修改吗？")) return;
    props.onClose();
  };
  const controls = <>
    <button aria-label={sidebarOpen ? "收起概念侧栏" : "展开概念侧栏"} title={sidebarOpen ? "收起概念侧栏" : "展开概念侧栏"} onClick={() => setSidebarOpen((value) => !value)}>{sidebarOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}</button>
    <button title={maximized ? "还原窗口" : "最大化窗口"} aria-label={maximized ? "还原窗口" : "最大化窗口"} onClick={toggleMaximize}>{maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</button>
    <button title="关闭" aria-label="关闭阅读窗口" onClick={close}><X size={17} /></button>
  </>;
  return <aside ref={windowRef} className={`answer-dialog${maximized ? " answer-dialog--maximized" : ""}${active ? " answer-dialog--active" : ""}${sidebarOpen ? " answer-dialog--with-sidebar" : ""}`}
    hidden={props.hidden} style={{ left: maximized ? 8 : position.x, top: maximized ? 60 : position.y, zIndex: props.zIndex ?? 100 }} aria-label="回答阅读器"
    onPointerDownCapture={props.onActivate} onFocusCapture={props.onActivate}>
    <div className="reader-main">
      <AnswerPane answerId={props.answerId} nodeUid={props.nodeUid} nodeTitle={props.nodeTitle} records={props.records} focusSelection={sourceFocus ?? props.focusSelection}
        readOnly={props.readOnly} active={!fullConcept && !props.hidden} controls={controls} onDirtyChange={onDirtyChange}
        onGenerateConcept={props.onGenerateConcept} onAskQuestion={props.onAskQuestion} onRetryQuestion={props.onRetryQuestion} onOpenNote={openNote} onRetitle={props.onRetitle} onDragStart={startDrag} onToggleMaximize={toggleMaximize} />
      {visitedConcepts.map((answerId) => <AnswerPane key={answerId} answerId={answerId} nodeUid="" records={props.records}
        readOnly={props.readOnly} active={fullConcept === answerId && !props.hidden} controls={controls} onDirtyChange={onDirtyChange} onBack={() => setFullConcept(null)}
        onGenerateConcept={props.onGenerateConcept} onAskQuestion={props.onAskQuestion} onRetryQuestion={props.onRetryQuestion} onOpenNote={openNote} onRetitle={props.onRetitle} onDragStart={startDrag} onToggleMaximize={toggleMaximize} />)}
    </div>
    {sidebarOpen && <ConceptSidebar records={related} selectedId={selectedConcept} onSelect={setSelectedConcept} onOpen={openFullConcept} onOpenNote={openNote} />}
  </aside>;
});
