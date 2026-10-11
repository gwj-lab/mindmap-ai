import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import YAML from "yaml";
import { answerDocumentSchema } from "../shared/project.js";
import type { AnswerDocument, AnswerMetadata, SaveResult } from "../shared/types.js";

function serializeAnswer(answer: AnswerDocument): string {
  return `---\n${YAML.stringify(answer.metadata).trimEnd()}\n---\n${answer.body}`;
}

export function parseAnswer(raw: string): AnswerDocument {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("Invalid answer frontmatter");
  return answerDocumentSchema.parse({
    metadata: YAML.parse(match[1] ?? ""),
    body: match[2] ?? ""
  });
}

export class AnswerRepository {
  readonly #root: string;
  #writeTail: Promise<void> = Promise.resolve();

  constructor(root: string) {
    this.#root = path.resolve(root);
  }

  async initialize(): Promise<void> {
    await mkdir(this.#root, { recursive: true });
  }

  async write(answer: AnswerDocument): Promise<SaveResult> {
    const validated = answerDocumentSchema.parse(answer);
    return this.#enqueueWrite(async () => {
      await this.initialize();
      await writeFileAtomic(this.#answerPath(validated.metadata.id), serializeAnswer(validated), { encoding: "utf8" });
      return { savedAt: new Date().toISOString() };
    });
  }

  async read(answerId: string): Promise<AnswerDocument | null> {
    try {
      return parseAnswer(await readFile(this.#answerPath(answerId), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async listDocuments(): Promise<AnswerDocument[]> {
    let files: string[];
    try {
      files = await readdir(this.#root);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return Promise.all(files
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map(async (file) => parseAnswer(await readFile(path.join(this.#root, file), "utf8"))));
  }

  async listIds(): Promise<Set<string>> {
    try {
      const files = await readdir(this.#root);
      return new Set(files
        .filter((file) => file.endsWith(".md"))
        .map((file) => file.slice(0, -3))
        .filter((id) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
      throw error;
    }
  }

  async list(): Promise<Array<{ id: string; title: string; capturedAt: string }>> {
    return (await this.listDocuments()).map((answer) => ({
      id: answer.metadata.id,
      title: answer.metadata.title,
      capturedAt: answer.metadata.capturedAt
    }));
  }

  async delete(answerId: string): Promise<void> {
    try {
      await unlink(this.#answerPath(answerId));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  #answerPath(answerId: string): string {
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(answerId)) throw new Error("Invalid answer id");
    const destination = path.resolve(this.#root, `${answerId}.md`);
    if (!destination.startsWith(`${this.#root}${path.sep}`)) throw new Error("Answer path escapes repository");
    return destination;
  }

  #enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#writeTail.then(operation, operation);
    this.#writeTail = result.then(() => undefined, () => undefined);
    return result;
  }
}

export type { AnswerMetadata };
