import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { rewriteProjectLinksForExport } from "../shared/portable-map.js";
import type { WorkspaceManifest } from "../shared/types.js";
import { readProjectAnswerIds } from "./reference-scanner.js";

const PROJECT_FILES = ["project.json", "mindmap.json"] as const;
const PORTABLE_FILES = ["map.md", "inbox.md", "history.md", "trash.md"] as const;

export async function exportStandaloneProject(
  rootInput: string,
  workspace: WorkspaceManifest,
  projectId: string,
  destinationInput: string
): Promise<void> {
  if (!workspace.projects.some((project) => project.projectId === projectId)) {
    throw new Error("Project does not exist in this workspace");
  }
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new Error("Invalid project id");
  const root = path.resolve(rootInput);
  const projectsRoot = path.resolve(root, "projects");
  const source = path.resolve(projectsRoot, projectId);
  if (!source.startsWith(`${projectsRoot}${path.sep}`)) throw new Error("Project path escapes workspace");
  const destination = path.resolve(destinationInput);
  await mkdir(destination, { recursive: true });

  await Promise.all(PROJECT_FILES.map((file) => copyFile(path.join(source, file), path.join(destination, file))));
  await Promise.all(PORTABLE_FILES.map(async (file) => {
    const contents = await readFile(path.join(source, file), "utf8");
    await writeFileAtomic(path.join(destination, file), rewriteProjectLinksForExport(contents), { encoding: "utf8" });
  }));

  const answerIds = await readProjectAnswerIds(source);
  // Include the transitive Markdown links, so concept/source backlinks remain portable.
  for (const answerId of answerIds) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(answerId)) throw new Error("Invalid answer id");
    const markdown = await readFile(path.join(root, "answers", `${answerId}.md`), "utf8");
    for (const match of markdown.matchAll(/\]\(([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.md\)/g)) answerIds.add(match[1]!);
  }
  const destinationAnswers = path.join(destination, "answers");
  await mkdir(destinationAnswers, { recursive: true });
  await Promise.all([...answerIds].map(async (answerId) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(answerId)) throw new Error("Invalid answer id");
    await copyFile(path.join(root, "answers", `${answerId}.md`), path.join(destinationAnswers, `${answerId}.md`));
  }));
}
