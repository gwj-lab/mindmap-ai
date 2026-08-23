import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import writeFileAtomic from "write-file-atomic";
import { z } from "zod";
import type { RecentWorkspaceEntry } from "../shared/types.js";

const HISTORY_FILE = "recent-workspaces.json";
const MAX_RECENT_WORKSPACES = 10;

const entrySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  path: z.string().min(1).max(32_768),
  lastOpenedAt: z.string().datetime()
}).strict();

const historySchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.array(entrySchema).max(MAX_RECENT_WORKSPACES)
}).strict();

interface HistoryFile {
  schemaVersion: 1;
  entries: RecentWorkspaceEntry[];
}

function pathKey(value: string): string {
  return path.resolve(value).toLocaleLowerCase();
}

export class RecentWorkspaceStore {
  constructor(private readonly directory: string) {}

  async list(): Promise<RecentWorkspaceEntry[]> {
    return structuredClone((await this.#read()).entries);
  }

  async mostRecent(): Promise<RecentWorkspaceEntry | null> {
    return (await this.list())[0] ?? null;
  }

  async resolve(id: string): Promise<string | null> {
    return (await this.#read()).entries.find((entry) => entry.id === id)?.path ?? null;
  }

  async record(workspacePath: string, name: string): Promise<RecentWorkspaceEntry> {
    const history = await this.#read();
    const key = pathKey(workspacePath);
    const existing = history.entries.find((entry) => pathKey(entry.path) === key);
    const entry: RecentWorkspaceEntry = {
      id: existing?.id ?? crypto.randomUUID(),
      name: name.trim(),
      path: workspacePath,
      lastOpenedAt: new Date().toISOString()
    };
    await this.#write({
      schemaVersion: 1,
      entries: [entry, ...history.entries.filter((item) => item.id !== entry.id)].slice(0, MAX_RECENT_WORKSPACES)
    });
    return structuredClone(entry);
  }

  async forget(id: string): Promise<void> {
    const history = await this.#read();
    await this.#write({ schemaVersion: 1, entries: history.entries.filter((entry) => entry.id !== id) });
  }

  async #read(): Promise<HistoryFile> {
    try {
      return historySchema.parse(JSON.parse(await readFile(path.join(this.directory, HISTORY_FILE), "utf8")));
    } catch {
      return { schemaVersion: 1, entries: [] };
    }
  }

  async #write(history: HistoryFile): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFileAtomic(path.join(this.directory, HISTORY_FILE), `${JSON.stringify(history, null, 2)}\n`, { mode: 0o600 });
  }
}
