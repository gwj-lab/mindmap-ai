import { useState } from "react";

interface ProjectNameDialogProps {
  parentProjectId: string | null;
  onSubmit(name: string, parentProjectId: string | null): Promise<void>;
  onClose(): void;
}

export function ProjectNameDialog({ parentProjectId, onSubmit, onClose }: ProjectNameDialogProps): React.JSX.Element {
  const [name, setName] = useState("新项目");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const isRoot = parentProjectId === null;

  const submit = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized) {
      setError("项目名称不能为空");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      await onSubmit(normalized, parentProjectId);
      onClose();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : "创建项目失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <section
        className="project-name-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={isRoot ? "新建主项目" : "新建子项目"}
      >
        <header><strong>{isRoot ? "新建主项目" : "新建子项目"}</strong></header>
        <form onSubmit={(event) => void submit(event)}>
          <label>
            {isRoot ? "主项目名称" : "子项目名称"}
            <input
              autoFocus
              aria-label={isRoot ? "主项目名称" : "子项目名称"}
              value={name}
              maxLength={120}
              disabled={submitting}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !submitting) onClose();
                if (event.key === "Enter" && !event.nativeEvent.isComposing && !submitting) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <div className="project-name-actions">
            <button type="button" disabled={submitting} onClick={onClose}>取消</button>
            <button className="primary" type="submit" disabled={submitting}>
              {submitting ? "正在创建…" : "创建项目"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
