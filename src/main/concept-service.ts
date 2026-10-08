import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import writeFileAtomic from "write-file-atomic";
import { conceptLibrarySchema, conceptPrompt, DEFAULT_CONCEPT_SETTINGS, type ConceptJob, type ConceptLibrary, type ConceptRecord, type ConceptReference, type ConceptRequest, type ConceptSettings } from "../shared/concepts.js";
import type { AnswerDocument, CapturedAnswerPayload, SaveResult } from "../shared/types.js";
import { AnswerRepository } from "./answer-repository.js";

const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const label = (text: string): string => text.replace(/([\\[\]])/g, "\\$1").replace(/\s+/g, " ");

export class ConceptService {
  #library: ConceptLibrary | null = null;
  #tail: Promise<unknown> = Promise.resolve();
  readonly answers: AnswerRepository;
  constructor(private readonly root: string, private readonly changed: () => void) { this.answers = new AnswerRepository(path.join(root, "answers")); }
  async get(): Promise<ConceptLibrary> {
    if (!this.#library) {
      try { this.#library = conceptLibrarySchema.parse(JSON.parse(await readFile(path.join(this.root, "concepts.json"), "utf8"))); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; this.#library = { settings: { ...DEFAULT_CONCEPT_SETTINGS }, records: [] }; }
      for (const record of this.#library.records) if (record.status === "generating") { record.status = "failed"; record.error = "上次生成被中断，请重试"; }
    }
    return structuredClone(this.#library);
  }
  #write<T>(operation: (library: ConceptLibrary) => Promise<T>): Promise<T> {
    const result = this.#tail.then(async () => {
      await this.get();
      const next = structuredClone(this.#library!);
      const result = await operation(next);
      await writeFileAtomic(path.join(this.root, "concepts.json"), JSON.stringify(conceptLibrarySchema.parse(next), null, 2), { encoding: "utf8" });
      this.#library = next; this.changed(); return result;
    });
    this.#tail = result.catch(() => undefined); return result;
  }
  settings(settings: ConceptSettings): Promise<ConceptLibrary> { return this.#write(async (library) => { library.settings = settings; return structuredClone(library); }); }
  writeEdited(answer: AnswerDocument, write: (answer: AnswerDocument) => Promise<SaveResult>): Promise<SaveResult> {
    return this.#write(async (library) => {
      const next = structuredClone(answer);
      for (const record of library.records) {
        if (record.status !== "ready" && !(record.status === "trash" && record.previousStatus === "ready")) continue;
        if (record.references.some((ref) => ref.sourceAnswerId === next.metadata.id) && !next.body.includes(`](${record.answerId}.md)`)) {
          next.body += `\n\n${next.body.includes("\n## 概念引用\n") ? "" : "## 概念引用\n\n"}- [${label(record.title)}](${record.answerId}.md)`;
        }
        if (record.answerId === next.metadata.id) for (const ref of record.references) if (!next.body.includes(`](${ref.sourceAnswerId}.md)`)) {
          next.body += `\n\n- [${label(ref.sourceTitle)}](${ref.sourceAnswerId}.md)\n\n  > ${ref.selection.sentence.replace(/\n/g, "\n  > ")}`;
        }
      }
      next.metadata.contentHash = hash(next.body);
      return write(next);
    });
  }
  async saveSource(payload: CapturedAnswerPayload): Promise<AnswerDocument> {
    const existing = (await this.answers.listDocuments()).find((answer) => !answer.metadata.conceptId && answer.metadata.provider === payload.provider && answer.metadata.sourceMessageId === payload.sourceMessageId && answer.metadata.sourceUrl === payload.sourceUrl && (answer.body === payload.markdown || answer.body.startsWith(`${payload.markdown}\n\n## 概念引用\n`)));
    if (existing) return existing;
    const now = new Date().toISOString();
    const answer: AnswerDocument = { metadata: { id: `source-${randomUUID()}`, provider: payload.provider, title: payload.markdown.match(/^#+\s+(.+)$/m)?.[1]?.slice(0, 160) || "概念来源回答", sourceUrl: payload.sourceUrl, sourceMessageId: payload.sourceMessageId, contentHash: hash(payload.markdown), capturedAt: now, updatedAt: now }, body: payload.markdown };
    await this.answers.write(answer); return answer;
  }
  prepare(request: ConceptRequest, projectId: string): Promise<ConceptJob> {
    return this.#write(async (library) => {
      const source = await this.answers.read(request.sourceAnswerId);
      if (!source) throw new Error("来源笔记不存在");
      const reference: ConceptReference = { ...request, projectId, sourceUrl: source.metadata.sourceUrl, sourceMessageId: source.metadata.sourceMessageId };
      const prior = library.records.find((record) => record.status !== "trash" && record.references[0]!.selection.text === request.selection.text && record.references[0]!.selection.sentence === request.selection.sentence && record.references[0]!.sourceTitle === request.sourceTitle);
      if (prior) {
        if (!prior.references.some((ref) => ref.sourceAnswerId === reference.sourceAnswerId && JSON.stringify(ref.selection) === JSON.stringify(reference.selection))) prior.references.push(reference);
        if (prior.status === "ready") await this.#link(prior, source);
        return { record: structuredClone(prior), background: library.settings.background, reused: true };
      }
      const id = randomUUID();
      const record: ConceptRecord = { id, answerId: `concept-${id}`, title: request.selection.text, provider: library.settings.provider === "current" ? source.metadata.provider : library.settings.provider, references: [reference], status: "generating", prompt: conceptPrompt(library.settings, request), tabId: `concept-tab-${id}`, createdAt: new Date().toISOString() };
      library.records.push(record);
      return { record: structuredClone(record), background: library.settings.background, reused: false };
    });
  }
  retry(id: string): Promise<ConceptJob> {
    return this.#write(async (library) => {
      const record = library.records.find((record) => record.id === id);
      if (!record || record.status !== "failed") throw new Error("此概念不能重试");
      record.status = "generating"; delete record.error; record.tabId = `concept-tab-${randomUUID()}`;
      record.provider = library.settings.provider === "current" ? (await this.answers.read(record.references[0]!.sourceAnswerId))!.metadata.provider : library.settings.provider;
      record.prompt = conceptPrompt(library.settings, record.references[0]!);
      return { record: structuredClone(record), background: library.settings.background, reused: false };
    });
  }
  fail(id: string, error: string): Promise<void> { return this.#write(async (library) => { const record = library.records.find((record) => record.id === id); if (record?.status === "generating") { record.status = "failed"; record.error = error.slice(0, 500); } }); }
  complete(id: string, payload: CapturedAnswerPayload): Promise<void> {
    return this.#write(async (library) => {
      const record = library.records.find((record) => record.id === id);
      if (record?.status !== "generating") return;
      if (record.provider !== payload.provider) throw new Error("概念回答平台不匹配");
      const now = new Date().toISOString();
      const body = `${payload.markdown}\n\n## 概念来源\n\n${record.references.map((ref) => `- [${label(ref.sourceTitle)}](${ref.sourceAnswerId}.md)\n\n  > ${ref.selection.sentence.replace(/\n/g, "\n  > ")}`).join("\n\n")}`;
      await this.answers.write({ metadata: { id: record.answerId, provider: payload.provider, title: record.title, conceptId: record.id, tags: ["概念"], sourceUrl: payload.sourceUrl, sourceMessageId: payload.sourceMessageId, contentHash: hash(body), capturedAt: record.createdAt, updatedAt: now }, body });
      for (const reference of record.references) { const source = await this.answers.read(reference.sourceAnswerId); if (source) await this.#link(record, source); }
      record.status = "ready"; delete record.error;
    });
  }
  async #link(record: ConceptRecord, source: AnswerDocument): Promise<void> {
    const link = `[${label(record.title)}](${record.answerId}.md)`;
    if (!source.body.includes(`](${record.answerId}.md)`)) {
      source.body += `\n\n${source.body.includes("\n## 概念引用\n") ? "" : "## 概念引用\n\n"}- ${link}`;
      source.metadata.contentHash = hash(source.body); source.metadata.updatedAt = new Date().toISOString(); await this.answers.write(source);
    }
    const concept = await this.answers.read(record.answerId);
    if (concept) for (const reference of record.references) if (!concept.body.includes(`](${reference.sourceAnswerId}.md)`)) {
      concept.body += `\n\n- [${label(reference.sourceTitle)}](${reference.sourceAnswerId}.md)\n\n  > ${reference.selection.sentence.replace(/\n/g, "\n  > ")}`;
      concept.metadata.contentHash = hash(concept.body); concept.metadata.updatedAt = new Date().toISOString(); await this.answers.write(concept);
    }
  }
  update(id: string, action: "trash" | "restore" | "delete" | "rename", title?: string): Promise<ConceptLibrary> {
    return this.#write(async (library) => {
      const record = library.records.find((record) => record.id === id);
      if (!record) throw new Error("概念不存在");
      if (record.status === "generating") throw new Error("请等待生成完成或失败");
      if (action === "trash") { record.previousStatus = record.status === "ready" ? "ready" : "failed"; record.status = "trash"; }
      else if (action === "restore") { if (record.status !== "trash") throw new Error("概念未在垃圾箱"); record.status = record.previousStatus ?? "ready"; }
      else if (action === "delete") { if (record.status !== "trash") throw new Error("请先移入垃圾箱"); library.records = library.records.filter((item) => item.id !== id); /* Keep linked Markdown documents accessible. */ }
      else if (title?.trim()) { record.title = title.trim(); const answer = await this.answers.read(record.answerId); if (answer) { answer.metadata.title = record.title; await this.answers.write(answer); } }
      return structuredClone(library);
    });
  }
}
