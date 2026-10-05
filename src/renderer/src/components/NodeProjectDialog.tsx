import { useEffect, useState } from "react";
import type { NodeProjectTarget, WorkspaceManifest } from "../../../shared/types.js";

interface NodeProjectDialogProps {
  title: string;
  workspace: WorkspaceManifest;
  onSubmit(target: NodeProjectTarget): Promise<void>;
  onClose(): void;
}

export function NodeProjectDialog({ title, workspace, onSubmit, onClose }: NodeProjectDialogProps): React.JSX.Element {
  const [mode, setMode] = useState<"create" | "existing">("create");
  const [name, setName] = useState(title.trim().slice(0, 120) || "新子项目");
  const [projectId, setProjectId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const ancestors = new Set<string>();
  let ancestor = workspace.activeProjectId;
  while (ancestor && !ancestors.has(ancestor)) {
    ancestors.add(ancestor);
    ancestor = workspace.projects.find((project) => project.projectId === ancestor)?.parentProjectId ?? null;
  }
  const choices = workspace.projects.filter((project) => !ancestors.has(project.projectId));
  useEffect(() => {
    window.mindmapAI.ai.setPanelVisible(false);
    return () => window.mindmapAI.ai.setPanelVisible(true);
  }, []);
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (submitting || (mode === "create" ? !name.trim() : !projectId)) return;
    setSubmitting(true);
    setError("");
    try {
      await onSubmit(mode === "create" ? { kind: "create", name: name.trim() } : { kind: "existing", projectId });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "关联子项目失败");
    } finally { setSubmitting(false); }
  };
  return <div className="dialog-backdrop">
    <section className="project-name-dialog" role="dialog" aria-modal="true" aria-label="关联子项目" onKeyDown={(event) => { if (event.key === "Escape" && !submitting) onClose(); }}>
      <header><strong>关联子项目</strong></header>
      <form onSubmit={(event) => void submit(event)}>
        <label>关联方式<select aria-label="关联方式" value={mode} disabled={submitting} onChange={(event) => setMode(event.target.value as "create" | "existing")}>
          <option value="create">从此节点创建子项目</option><option value="existing">关联已有项目</option>
        </select></label>
        {mode === "create" ? <>
          <p>此节点及其子分支将复制为子项目的中心节点和分支，原导图保留入口与内容。</p>
          <label>子项目名称<input autoFocus aria-label="子项目名称" maxLength={120} disabled={submitting} value={name} onChange={(event) => setName(event.target.value)} /></label>
        </> : <>
          <p>所选项目将成为当前项目的子项目；此节点显示它的中心节点名称，所选项目的内容保留。</p>
          <label>目标项目<select aria-label="目标项目" value={projectId} disabled={submitting} onChange={(event) => setProjectId(event.target.value)}>
            <option value="">请选择项目</option>{choices.map((project) => <option key={project.projectId} value={project.projectId}>{project.name}</option>)}
          </select></label>
        </>}
        {error && <p role="alert">{error}</p>}
        <div className="project-name-actions"><button type="button" disabled={submitting} onClick={onClose}>取消</button><button className="primary" type="submit" disabled={submitting || (mode === "create" ? !name.trim() : !projectId)}>{submitting ? "正在关联…" : "关联项目"}</button></div>
      </form>
    </section>
  </div>;
}
