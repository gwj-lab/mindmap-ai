import { z } from "zod";
import type { CandidateNode } from "./types.js";

const localId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
export const conceptSelectionSchema = z.object({
  text: z.string().trim().min(1).max(160), sentence: z.string().trim().min(1).max(12000),
  prefix: z.string().max(160), suffix: z.string().max(160)
}).strict();
export type ConceptSelection = z.infer<typeof conceptSelectionSchema>;
export const DEFAULT_CONCEPT_PROMPT = '当前主题是“{title}”。原文中的完整句子是：“{sentence}”。请解释这句话中“{concept}”的具体含义，结合当前主题说明它在这里的作用，并给出一个贴合语境的例子。请直接在聊天正文回答，不创建云端文档。';
export const conceptSettingsSchema = z.object({
  provider: z.enum(["current", "chatgpt", "yuanbao", "doubao"]).default("current"),
  prompt: z.string().trim().min(1).max(4000).refine((text) => text.includes("{concept}") && text.includes("{sentence}"), "模板必须包含 {concept} 和 {sentence}"),
  background: z.boolean().default(false)
});
export type ConceptSettings = z.infer<typeof conceptSettingsSchema>;
export const DEFAULT_CONCEPT_SETTINGS: ConceptSettings = { provider: "current", prompt: DEFAULT_CONCEPT_PROMPT, background: false };
export const conceptRequestSchema = z.object({
  sourceAnswerId: localId, sourceTitle: z.string().trim().min(1).max(500), selection: conceptSelectionSchema
}).strict();
export type ConceptRequest = z.infer<typeof conceptRequestSchema>;
export const conceptReferenceSchema = conceptRequestSchema.extend({
  projectId: z.string().uuid(), sourceUrl: z.string().url().startsWith("https://"), sourceMessageId: z.string().min(1).max(256)
});
export type ConceptReference = z.infer<typeof conceptReferenceSchema>;
export const conceptRecordSchema = z.object({
  id: localId, answerId: localId, title: z.string().trim().min(1).max(160), provider: z.enum(["chatgpt", "yuanbao", "doubao"]),
  status: z.enum(["generating", "ready", "failed", "trash"]), previousStatus: z.enum(["ready", "failed"]).optional(),
  references: z.array(conceptReferenceSchema).min(1), prompt: z.string().max(20000), tabId: z.string().min(1).max(128),
  error: z.string().max(500).optional(), createdAt: z.string().datetime()
});
export type ConceptRecord = z.infer<typeof conceptRecordSchema>;
export const conceptLibrarySchema = z.object({ settings: conceptSettingsSchema, records: z.array(conceptRecordSchema) });
export type ConceptLibrary = z.infer<typeof conceptLibrarySchema>;
export interface ConceptJob { record: ConceptRecord; background: boolean; reused: boolean }
export function conceptPrompt(settings: ConceptSettings, request: ConceptRequest): string {
  return settings.prompt.replace(/\{(title|sentence|concept)\}/g, (_, key: string) => ({ title: request.sourceTitle, sentence: request.selection.sentence, concept: request.selection.text })[key]!);
}
export function conceptCandidate(record: ConceptRecord): CandidateNode {
  return { id: record.id, answerId: record.answerId, title: record.title, conceptId: record.id, extractionMode: "single", children: [], createdAt: record.createdAt };
}
export function sentenceAt(text: string, start: number, end: number): string {
  return [...new Intl.Segmenter("zh", { granularity: "sentence" }).segment(text)].filter((segment) => segment.index < end && segment.index + segment.segment.length > start).map((segment) => segment.segment).join("").trim() || text.trim();
}
