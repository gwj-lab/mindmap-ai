import { useEffect, useRef, useState } from "react";
import { Focus, Merge, Minus, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { nodesForMerge } from '../../state/node-merge.js';
import { MergeNodesDialog } from './MergeNodesDialog.js';
import MindMap from "simple-mind-map";
import Drag from "simple-mind-map/src/plugins/Drag.js";
import KeyboardNavigation from "simple-mind-map/src/plugins/KeyboardNavigation.js";
import Select from "simple-mind-map/src/plugins/Select.js";
import type { MindMapNodeData } from "../../../shared/types.js";
import { shouldEnableMapShortcut } from "./map-shortcut-policy.js";
import {
  fromMindMapLibraryNode,
  toMindMapLibraryNode,
  type MindMapLibraryNode
} from "./mindmap-node-adapter.js";
import { NodeContextMenu } from "./NodeContextMenu.js";

const registerPlugin = MindMap.usePlugin.bind(MindMap);
registerPlugin(Drag);
registerPlugin(KeyboardNavigation);
registerPlugin(Select);

interface RenderedNode {
  uid: string;
  group: { node: SVGGraphicsElement };
  children: RenderedNode[];
  nodeData: MindMapLibraryNode;
  highlight(): void;
  closeHighlight(): void;
}

interface SelectionPluginInstance {
  isMousedown: boolean;
  mouseDownX: number;
  mouseDownY: number;
  mouseMoveX: number;
  mouseMoveY: number;
  checkInNodes: (() => void) & { flush(): void; cancel(): void };
}

function installFlushableSelectionCheck(mindMap: MindMap): SelectionPluginInstance | undefined {
  const select = (mindMap as unknown as { select?: SelectionPluginInstance }).select;
  if (!select) return undefined;
  const rawCheck = (Select as { prototype: { checkInNodes(this: SelectionPluginInstance): void } })
    .prototype.checkInNodes;
  let timer: number | null = null;
  const run = (): void => rawCheck.call(select);
  const check = (() => {
    if (timer !== null) return;
    timer = window.setTimeout(() => {
      timer = null;
      run();
    }, 300);
  }) as SelectionPluginInstance["checkInNodes"];
  check.flush = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
    run();
  };
  check.cancel = () => {
    if (timer !== null) window.clearTimeout(timer);
    timer = null;
  };
  select.checkInNodes = check;
  return select;
}

export interface MindMapController {
  focusNode(uid: string): void;
  command(name: string): void;
  applyTheme(name: "paper" | "night" | "ink"): void;
}

interface MindMapPanelProps {
  onCreateAttachment?(nodeUid: string, kind: 'blank' | 'import'): void;
  projectId: string;
  data: MindMapNodeData;
  readOnly?: boolean;
  onChange(data: MindMapNodeData): void;
  onCandidateDrop(candidateId: string, targetUid: string): void;
  onHistoryDrop(historyId: string, targetUid: string): void;
  onOpenAnswer(answerId: string, nodeUid: string): void;
  onOpenProject?(projectId: string): void;
  onLinkProject?(nodeUid: string, title: string): void;
  onUnlinkProject?(nodeUid: string): void;
  onRenameNode(nodeUid: string, title: string): void;
  onCreateChild(nodeUid: string): void;
  onCreateSibling(nodeUid: string): void;
  onMoveToHistory(nodeUid: string): void;
  onDeleteNodes(nodeUids: string[]): void;
  onMergeNodes?(nodeUids: string[], targetUid: string, title: string, answerId?: string): void;
  onController(controller: MindMapController | null): void;
}

interface ContextMenuState {
  x: number;
  y: number;
  nodeUid: string;
  title: string;
  answerId?: string;
  linkedProjectId?: string;
  initialRename?: boolean;
  isRoot: boolean;
}

const THEMES = {
  paper: {
    backgroundColor: "#f8faf9",
    lineColor: "#6ba69e",
    lineStyle: "curve",
    root: { fillColor: "#153c42", color: "#ffffff", borderRadius: 9, fontFamily: "Segoe UI, Microsoft YaHei" },
    second: { fillColor: "#ffffff", color: "#1d3438", borderColor: "#62aa9e", borderRadius: 8, fontFamily: "Segoe UI, Microsoft YaHei" },
    node: { fillColor: "#ffffff", color: "#31484c", borderColor: "#c7d8d5", borderWidth: 1, borderRadius: 7, fontFamily: "Segoe UI, Microsoft YaHei" }
  },
  night: {
    backgroundColor: "#172226",
    lineColor: "#5fc7b6",
    lineStyle: "curve",
    root: { fillColor: "#e0a44a", color: "#172226", borderRadius: 9, fontFamily: "Segoe UI, Microsoft YaHei" },
    second: { fillColor: "#25363b", color: "#eff7f5", borderColor: "#4e8f87", borderRadius: 8, fontFamily: "Segoe UI, Microsoft YaHei" },
    node: { fillColor: "#223136", color: "#dce9e7", borderColor: "#3f5c60", borderWidth: 1, borderRadius: 7, fontFamily: "Segoe UI, Microsoft YaHei" }
  },
  ink: {
    backgroundColor: "#f2f0eb",
    lineColor: "#202a2c",
    lineStyle: "straight",
    root: { fillColor: "#202a2c", color: "#ffffff", borderRadius: 2, fontFamily: "Microsoft YaHei" },
    second: { fillColor: "#f9f8f4", color: "#202a2c", borderColor: "#202a2c", borderRadius: 2, fontFamily: "Microsoft YaHei" },
    node: { fillColor: "transparent", color: "#202a2c", borderColor: "#6d7374", borderWidth: 0, borderRadius: 0, fontFamily: "Microsoft YaHei" }
  }
} as const;

function findAtPoint(root: RenderedNode | null, x: number, y: number): RenderedNode | null {
  if (!root) return null;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    const rect = node.group.node.getBoundingClientRect();
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) return node;
    stack.push(...node.children);
  }
  return null;
}

function indexRenderedNodes(
  root: RenderedNode | null,
  result: WeakMap<SVGGraphicsElement, RenderedNode>
): void {
  if (!root) return;
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    result.set(node.group.node, node);
    for (const child of node.children) stack.push(child);
  }
}

export function MindMapPanel(props: MindMapPanelProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MindMap | null>(null);
  const highlightedRef = useRef<RenderedNode | null>(null);
  const lastExternalData = useRef(props.data);
  const lastExternalProjectId = useRef(props.projectId);
  const applyingExternalData = useRef(false);
  const handlersRef = useRef(props);
  const selectedNodeRef = useRef<RenderedNode | null>(null);
  const renderedNodeByElement = useRef(new WeakMap<SVGGraphicsElement, RenderedNode>());
  const dragHitRef = useRef<{ x: number; y: number; node: RenderedNode | null } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [selectedUids, setSelectedUids] = useState<string[]>([]);
  const [mergeNodes, setMergeNodes] = useState<MindMapNodeData[] | null>(null);
  const [mergeError, setMergeError] = useState('');
  const openMerge = (): void => {
    if (props.readOnly) return;
    try { setMergeNodes(nodesForMerge(props.data, selectedUids)); setMergeError(''); }
    catch (cause) { setMergeError(cause instanceof Error ? cause.message : '无法合并所选节点'); }
  };

  useEffect(() => {
    handlersRef.current = props;
  }, [props]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const mindMap = new MindMap({
      el: host,
      data: toMindMapLibraryNode(handlersRef.current.data),
      layout: "mindMap",
      theme: "default",
      themeConfig: THEMES.paper,
      enableCtrlKeyNodeSelection: true,
      useLeftKeySelectionRightKeyDrag: true,
      enableFreeDrag: false,
      mousewheelAction: "zoom",
      enableShortcutOnlyWhenMouseInSvg: true,
      customCheckEnableShortcut: (event: KeyboardEvent) => shouldEnableMapShortcut(event.target),
      fit: true,
      readonly: handlersRef.current.readOnly === true,
      noteIcon: {
        icon: "",
        style: { size: 12, color: "#1b8f7f" }
      }
    });
    mapRef.current = mindMap;
    const refreshRenderedNodeIndex = (): void => indexRenderedNodes(
      mindMap.renderer.root as RenderedNode | null,
      renderedNodeByElement.current
    );
    refreshRenderedNodeIndex();
    mindMap.on("node_tree_render_end", refreshRenderedNodeIndex);
    const selection = installFlushableSelectionCheck(mindMap);
    lastExternalData.current = handlersRef.current.data;
    lastExternalProjectId.current = handlersRef.current.projectId;

    mindMap.on("data_change", (raw) => {
      if (applyingExternalData.current) return;
      const converted = fromMindMapLibraryNode(raw as MindMapLibraryNode);
      lastExternalData.current = converted;
      handlersRef.current.onChange(converted);
    });
    mindMap.on("node_active", (rawNode, rawList) => {
      const list = Array.isArray(rawList) ? rawList as RenderedNode[] : [];
      setSelectedUids(list.map((node) => node.uid));
      selectedNodeRef.current = rawNode as RenderedNode | null ?? list.at(-1) ?? null;
      const selectedNode = selectedNodeRef.current;
      if (selectedNode && selectedNode.uid !== mindMap.renderer.root?.uid) {
        const element = selectedNode.group.node;
        element.setAttribute("draggable", handlersRef.current.readOnly ? "false" : "true");
        element.ondragstart = (event: DragEvent) => {
          if (handlersRef.current.readOnly || !event.dataTransfer) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("application/x-mindmap-subtree", selectedNode.uid);
          window.mindmapAI?.ai.beginLocalDrag();
        };
        element.ondragend = () => window.mindmapAI?.ai.endLocalDrag();
      }
    });
    mindMap.on("node_contextmenu", (rawEvent, rawNode) => {
      const event = rawEvent as MouseEvent;
      const node = rawNode as RenderedNode;
      event.preventDefault();
      selectedNodeRef.current = node;
      const data = node.nodeData.data;
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        nodeUid: node.uid,
        title: String(data.text ?? ""),
        isRoot: node.uid === mindMap.renderer.root?.uid,
        ...(typeof data.answerId === "string" ? { answerId: data.answerId } : {}),
        ...(typeof data.linkedProjectId === "string" ? { linkedProjectId: data.linkedProjectId } : {})
      });
    });
    mindMap.on("node_dblclick", (rawNode, event) => {
      const node = rawNode as RenderedNode;
      const answerId = node.nodeData.data.answerId;
      const projectId = node.nodeData.data.linkedProjectId;
      if (typeof projectId === "string" || typeof answerId === "string") {
        (event as MouseEvent | undefined)?.preventDefault();
        mindMap.renderer.textEdit?.hideEditTextBox();
        if (typeof projectId === "string") handlersRef.current.onOpenProject?.(projectId);
        else handlersRef.current.onOpenAnswer(answerId as string, node.uid);
      }
    });

    // Select throttles hit testing by 300ms. Flush the final pointer position so
    // a quick marquee followed immediately by a keyboard command is reliable.
    const flushMarqueeSelection = (): void => {
      if (!selection?.isMousedown) return;
      if (
        Math.abs(selection.mouseMoveX - selection.mouseDownX) <= 10
        && Math.abs(selection.mouseMoveY - selection.mouseDownY) <= 10
      ) return;
      selection.checkInNodes.flush();
    };
    host.addEventListener("mouseup", flushMarqueeSelection, true);

    const selected = (): RenderedNode | null => selectedNodeRef.current;
    const selectedUids = (): string[] => {
      const rootUid = mindMap.renderer.root?.uid;
      return (mindMap.renderer.activeNodeList as RenderedNode[])
        .filter((node) => node.uid !== rootUid)
        .map((node) => node.uid);
    };
    const openRename = (): void => {
      const node = selected();
      if (!node) return;
      const rect = node.group.node.getBoundingClientRect();
      const data = node.nodeData.data;
      setContextMenu({
        x: rect.left + Math.min(rect.width, 28),
        y: rect.bottom + 4,
        nodeUid: node.uid,
        title: String(data.text ?? ""),
        isRoot: node.uid === mindMap.renderer.root?.uid,
        ...(typeof data.answerId === "string" ? { answerId: data.answerId } : {}),
        ...(typeof data.linkedProjectId === "string" ? { linkedProjectId: data.linkedProjectId } : {}),
        initialRename: true
      });
    };
    mindMap.keyCommand.removeShortcut("Del|Backspace");
    mindMap.keyCommand.addShortcut("Del|Backspace", () => {
      const nodeUids = selectedUids();
      if (nodeUids.length > 0) handlersRef.current.onDeleteNodes(nodeUids);
    });
    mindMap.keyCommand.removeShortcut("F2");
    mindMap.keyCommand.addShortcut("F2|Spacebar", openRename);
    mindMap.keyCommand.addShortcut("Alt+Up", () => mindMap.execCommand("UP_NODE"));
    mindMap.keyCommand.addShortcut("Alt+Down", () => mindMap.execCommand("DOWN_NODE"));
    mindMap.keyCommand.removeShortcut("Control+Enter");
    mindMap.keyCommand.addShortcut("Control+Enter", () => {
      const node = selected();
      if (node) mindMap.execCommand("SET_NODE_EXPAND", node, !node.nodeData.data.expand);
    });

    const controller: MindMapController = {
      focusNode: (uid) => mindMap.renderer.goTargetNode(uid),
      command: (name) => {
        if (name === "ZOOM_IN") mindMap.view.enlarge();
        else if (name === "ZOOM_OUT") mindMap.view.narrow();
        else if (name === "FIT") mindMap.view.fit();
        else mindMap.execCommand(name);
      },
      applyTheme: (name) => mindMap.setThemeConfig(THEMES[name] as unknown as Record<string, unknown>)
    };
    handlersRef.current.onController(controller);
    let resizeFrame: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        mindMap.resize();
      });
    });
    resizeObserver.observe(host);
    return () => {
      resizeObserver.disconnect();
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      mindMap.off("node_tree_render_end", refreshRenderedNodeIndex);
      host.removeEventListener("mouseup", flushMarqueeSelection, true);
      selection?.checkInNodes.cancel();
      handlersRef.current.onController(null);
      mapRef.current = null;
      mindMap.destroy();
    };
  }, []);

  useEffect(() => {
    const projectChanged = props.projectId !== lastExternalProjectId.current;
    if (mapRef.current && (projectChanged || props.data !== lastExternalData.current)) {
      lastExternalProjectId.current = props.projectId;
      lastExternalData.current = props.data;
      const data = toMindMapLibraryNode(props.data);
      if (projectChanged) mapRef.current.setData(data);
      else {
        applyingExternalData.current = true;
        try {
          mapRef.current.updateData(data);
        } finally {
          applyingExternalData.current = false;
        }
      }
    }
  }, [props.data, props.projectId]);

  const clearHighlight = (): void => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    dragHitRef.current = null;
    highlightedRef.current?.closeHighlight();
    highlightedRef.current = null;
  };

  const updateHighlight = (node: RenderedNode | null): void => {
    if (node === highlightedRef.current) return;
    clearHighlight();
    node?.highlight();
    highlightedRef.current = node;
  };

  const command = (name: string): void => {
    if (name === "ZOOM_IN") mapRef.current?.view.enlarge();
    else if (name === "ZOOM_OUT") mapRef.current?.view.narrow();
    else if (name === "FIT") mapRef.current?.view.fit();
    else if (name === "REMOVE_NODE") {
      const mindMap = mapRef.current;
      if (!mindMap) return;
      const rootUid = mindMap.renderer.root?.uid;
      const nodeUids = (mindMap.renderer.activeNodeList as RenderedNode[])
        .filter((node) => node.uid !== rootUid)
        .map((node) => node.uid);
      if (nodeUids.length > 0) props.onDeleteNodes(nodeUids);
    } else mapRef.current?.execCommand(name);
  };

  return (
    <section className="mindmap-panel">
      <div className="map-toolbar" aria-label="导图工具栏">
        <button title="撤销 Ctrl+Z" onClick={() => command("BACK")}><Undo2 size={16} /></button>
        <button title="重做 Ctrl+Y" onClick={() => command("FORWARD")}><Redo2 size={16} /></button>
        <span />
        <button title="新建子节点 Tab" onClick={() => command("INSERT_CHILD_NODE")}><Plus size={16} /></button>
        <button title="删除节点" onClick={() => command("REMOVE_NODE")}><Trash2 size={16} /></button>
        <button title="合并选中节点" aria-label="合并选中节点" disabled={props.readOnly || selectedUids.length < 2 || !props.onMergeNodes} onClick={openMerge}><Merge size={16} /></button>
        <span />
        <button title="缩小" onClick={() => command("ZOOM_OUT")}><Minus size={16} /></button>
        <button title="放大" onClick={() => command("ZOOM_IN")}><Plus size={16} /></button>
        <button title="适应画布" onClick={() => command("FIT")}><Focus size={16} /></button>
      </div>
      {mergeError && <div className="map-merge-error" role="alert">{mergeError}<button onClick={() => setMergeError('')}>×</button></div>}
      <div
        ref={hostRef}
        className="mindmap-canvas"
        onContextMenuCapture={(event) => {
          if (props.readOnly || selectedUids.length < 2) return;
          const element = (event.target as Element).closest('.smm-node');
          const node = element ? renderedNodeByElement.current.get(element as SVGGraphicsElement) : undefined;
          if (!node || !selectedUids.includes(node.uid)) return;
          // The library normally clears multi-selection before opening a menu.
          event.preventDefault(); event.stopPropagation();
          mapRef.current?.emit('node_contextmenu', event.nativeEvent, node);
        }}
        onDragOver={(event) => {
          const isCandidate = event.dataTransfer.types.includes("application/x-mindmap-candidate");
          const isHistory = event.dataTransfer.types.includes("application/x-mindmap-history");
          if (!isCandidate && !isHistory) return;
          event.preventDefault();
          const target = event.target instanceof Element ? event.target.closest(".smm-node") : null;
          const directNode = target ? renderedNodeByElement.current.get(target as SVGGraphicsElement) ?? null : null;
          if (directNode) updateHighlight(directNode);
          else {
            dragHitRef.current = { x: event.clientX, y: event.clientY, node: null };
            if (dragFrameRef.current === null) {
              dragFrameRef.current = window.requestAnimationFrame(() => {
                dragFrameRef.current = null;
                const point = dragHitRef.current;
                if (!point) return;
                point.node = findAtPoint(mapRef.current?.renderer.root as RenderedNode | null, point.x, point.y);
                updateHighlight(point.node);
              });
            }
          }
          const node = directNode ?? (dragHitRef.current?.x === event.clientX && dragHitRef.current?.y === event.clientY ? dragHitRef.current.node : highlightedRef.current);
          event.dataTransfer.dropEffect = node ? "move" : "none";
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) clearHighlight();
        }}
        onDrop={(event) => {
          event.preventDefault();
          const root = mapRef.current?.renderer.root as RenderedNode | null;
          const target = event.target instanceof Element ? event.target.closest(".smm-node") : null;
          const directNode = target ? renderedNodeByElement.current.get(target as SVGGraphicsElement) ?? null : null;
          const hitNode = directNode ?? findAtPoint(root, event.clientX, event.clientY) ?? highlightedRef.current;
          const candidateId = event.dataTransfer.getData("application/x-mindmap-candidate");
          const historyId = event.dataTransfer.getData("application/x-mindmap-history");
          const targetUid = hitNode?.uid;
          clearHighlight();
          window.mindmapAI?.ai.endLocalDrag();
          if (candidateId && targetUid) props.onCandidateDrop(candidateId, targetUid);
          else if (historyId && targetUid) props.onHistoryDrop(historyId, targetUid);
        }}
      />
      {contextMenu && (
        <NodeContextMenu
          {...contextMenu}
          onClose={() => setContextMenu(null)}
          onRename={props.onRenameNode}
          onCreateChild={props.onCreateChild}
          onCreateSibling={props.onCreateSibling}
          onMoveToHistory={props.onMoveToHistory}
          onDelete={(nodeUid) => props.onDeleteNodes([nodeUid])}
          onOpenAnswer={props.onOpenAnswer}
          onCreateAttachment={props.readOnly ? undefined : props.onCreateAttachment}
          onLinkProject={props.readOnly ? undefined : props.onLinkProject}
          onUnlinkProject={props.readOnly ? undefined : props.onUnlinkProject}
          onMerge={props.readOnly || !props.onMergeNodes ? undefined : openMerge}
          canMerge={selectedUids.length >= 2}
        />
      )}
      {mergeNodes && <MergeNodesDialog nodes={mergeNodes} onClose={() => setMergeNodes(null)} onMerge={(targetUid, title, answerId) => {
        props.onMergeNodes?.(mergeNodes.map((node) => node.uid), targetUid, title, answerId);
        setMergeNodes(null); setSelectedUids([]);
      }} />}
    </section>
  );
}
