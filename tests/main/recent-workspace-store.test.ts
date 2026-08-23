import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { RecentWorkspaceStore } from "../../src/main/recent-workspace-store.js";

const roots: string[] = [];

afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

async function setup(): Promise<{ directory: string; store: RecentWorkspaceStore }> {
  const directory = await mkdtemp(path.join(tmpdir(), "mindmap-recents-"));
  roots.push(directory);
  return { directory, store: new RecentWorkspaceStore(directory) };
}

describe("RecentWorkspaceStore", () => {
  test("keeps a deduplicated MRU list with stable opaque IDs", async () => {
    const { store } = await setup();
    const first = await store.record("C:\\Research", "Research");
    await store.record("C:\\Other", "Other");
    const reopened = await store.record("c:\\research", "Renamed Research");

    expect(reopened.id).toBe(first.id);
    expect(await store.list()).toEqual([
      expect.objectContaining({ id: first.id, name: "Renamed Research", path: "c:\\research" }),
      expect.objectContaining({ name: "Other", path: "C:\\Other" })
    ]);
    expect(await store.resolve(first.id)).toBe("c:\\research");
    expect(await store.mostRecent()).toMatchObject({ id: first.id });
  });

  test("limits history to ten entries", async () => {
    const { store } = await setup();
    for (let index = 0; index < 12; index += 1) {
      await store.record(`C:\\Workspace-${index}`, `Workspace ${index}`);
    }

    const entries = await store.list();
    expect(entries).toHaveLength(10);
    expect(entries[0]?.name).toBe("Workspace 11");
    expect(entries.at(-1)?.name).toBe("Workspace 2");
  });

  test("recovers from corrupt history and forgets only the history entry", async () => {
    const { directory, store } = await setup();
    const workspace = path.join(directory, "workspace");
    await mkdir(workspace);
    await writeFile(path.join(directory, "recent-workspaces.json"), "not-json", "utf8");
    expect(await store.list()).toEqual([]);

    const entry = await store.record(workspace, "Workspace");
    await store.forget(entry.id);

    expect(await store.list()).toEqual([]);
    await expect(readFile(path.join(directory, "recent-workspaces.json"), "utf8")).resolves.toContain('"entries": []');
    await expect(readFile(path.join(workspace, "missing.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
