import { contentHash } from "../shared/content.js";
import { extractExpandedTitles, extractSingleTitle } from "../shared/title-extraction.js";
import type {
  AnswerDocument,
  CandidateNode,
  CapturedAnswerPayload,
  CaptureAcknowledgement,
  PublicAiSettings,
  UiPreferences
} from "../shared/types.js";
import { ProjectStore } from "./project-store.js";
import type { TitleExtractionOptions } from "./title-service.js";

interface TitleExtractor {
  extract(markdown: string, options: TitleExtractionOptions): Promise<{ title: string; subtitles: string[] }>;
  extractWithStatus?(markdown: string, options: TitleExtractionOptions): Promise<{
    title: string;
    subtitles: string[];
    apiWarning?: string;
  }>;
}

interface SettingsReader {
  getPublicSettings(): Promise<PublicAiSettings>;
  getApiKey(): Promise<string | null>;
}

interface CaptureServiceOptions {
  captureMode?: UiPreferences['captureMode'];
  onCaptured?(acknowledgement: Extract<CaptureAcknowledgement, { status: "captured" }>): void;
  expansionPrompt?: string;
  portable?: boolean;
  titleService?: TitleExtractor;
  settingsStore?: SettingsReader;
}

const LEGACY_PREFERENCES: UiPreferences = {
  theme: "system",
  autoHoverCapture: true,
  captureMode: "single",
  titleSource: "local"
};

function localTitles(markdown: string, mode: "single" | "expanded"): { title: string; subtitles: string[] } {
  return mode === "expanded"
    ? extractExpandedTitles(markdown)
    : { title: extractSingleTitle(markdown), subtitles: [] };
}

export class CaptureService {
  constructor(
    private readonly store: ProjectStore,
    private readonly options: CaptureServiceOptions = {}
  ) {}

  async capture(payload: CapturedAnswerPayload): Promise<CaptureAcknowledgement> {
    try {
      const hash = await contentHash(payload.markdown);
      const savedPreferences = this.options.portable
        ? (await this.store.loadPortable()).state.uiPreferences
        : LEGACY_PREFERENCES;
      const preferences = { ...savedPreferences, captureMode: this.options.captureMode ?? savedPreferences.captureMode };
      const local = localTitles(payload.markdown, preferences.captureMode);
      const now = new Date().toISOString();
      const answer: AnswerDocument = {
        metadata: {
          id: crypto.randomUUID(),
          provider: payload.provider,
          title: local.title,
          sourceUrl: payload.sourceUrl,
          sourceMessageId: payload.sourceMessageId,
          contentHash: hash,
          capturedAt: now,
          updatedAt: now
        },
        body: payload.markdown
      };

      await this.store.writeAnswer(answer);
      const candidate: CandidateNode = {
        id: `candidate-${answer.metadata.id}`,
        answerId: answer.metadata.id,
        title: local.title,
        extractionMode: preferences.captureMode,
        children: [],
        createdAt: now
      };

      const persist = async (): Promise<void> => {
        if (this.options.portable) { await this.store.appendPortableCandidate(candidate); return; }
        const snapshot = await this.store.load();
        await this.store.save({
          ...snapshot,
          workspace: {
            ...snapshot.workspace,
            candidates: [
              ...snapshot.workspace.candidates.filter((item) => item.answerId !== candidate.answerId),
              candidate
            ]
          }
        });
      };
      await persist();
      this.options.onCaptured?.({ status: "captured", answer, candidate: structuredClone(candidate), phase: "saved" });
      const extracted = await this.#extractTitles(payload.markdown, preferences, local);
      candidate.title = extracted.title;
      candidate.children = preferences.captureMode === "expanded" ? extracted.subtitles.map((title) => ({ id: crypto.randomUUID(), title })) : [];
      try { await persist(); }
      catch { return { status: "captured", answer, candidate: { ...candidate, title: local.title, children: [] }, apiWarning: "原文已保存，节点生成结果保存失败，请重新捕获" }; }
      return { status: "captured", answer, candidate, ...(extracted.apiWarning ? { apiWarning: extracted.apiWarning } : {}) };
    } catch (error) {
      return {
        status: "failed",
        message: error instanceof Error ? error.message : "回答保存失败"
      };
    }
  }

  async #extractTitles(
    markdown: string,
    preferences: UiPreferences,
    fallback: { title: string; subtitles: string[] }
  ): Promise<{ title: string; subtitles: string[]; apiWarning?: string }> {
    const expansionPrompt = preferences.captureMode === "expanded" ? this.options.expansionPrompt?.trim() : undefined;
    const unavailable = expansionPrompt ? { ...fallback, apiWarning: "分点要求需要配置 API 密钥，已使用本地规则" } : fallback;
    if ((!expansionPrompt && preferences.titleSource === "local") || !this.options.titleService || !this.options.settingsStore) return unavailable;
    try {
      const [settings, apiKey] = await Promise.all([
        this.options.settingsStore.getPublicSettings(),
        this.options.settingsStore.getApiKey()
      ]);
      if (!settings.hasApiKey || !apiKey) return unavailable;
      const extractionOptions = {
        baseUrl: settings.baseUrl,
        model: settings.model,
        apiKey,
        mode: preferences.captureMode,
        ...(expansionPrompt ? { expansionPrompt } : {})
      };
      return this.options.titleService.extractWithStatus
        ? await this.options.titleService.extractWithStatus(markdown, extractionOptions)
        : await this.options.titleService.extract(markdown, extractionOptions);
    } catch {
      return { ...fallback, apiWarning: "API 连接失败，已使用本地规则" };
    }
  }
}
