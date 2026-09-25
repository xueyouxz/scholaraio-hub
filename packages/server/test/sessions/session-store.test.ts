import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../../src/sessions/SessionStore.js";

describe("SessionStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-store-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("sets an unreadable session aside and loads the others", async () => {
    const store = new SessionStore(root);
    await store.initialize();
    const good = await store.create({ title: "ok", provider: "claude", paperIds: [] });
    const broken = join(root, "sessions", "broken");
    await mkdir(broken);
    await writeFile(join(broken, "session.json"), "{ not json");

    const restored = new SessionStore(root);
    await restored.initialize();

    expect(restored.list().map((session) => session.id)).toEqual([good.id]);
    const files = await readdir(broken);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^session\.json\.corrupt-\d+$/);
  });

  it("reports each failed write to its caller and keeps writing after it", async () => {
    const store = new SessionStore(root);
    await store.initialize();
    const record = await store.create({ title: "ok", provider: "codex", paperIds: [] });
    await rm(join(root, "sessions", record.id), { recursive: true });
    await expect(store.save(record)).rejects.toThrow();
    await mkdir(join(root, "sessions", record.id), { recursive: true });
    record.title = "later";
    await store.save(record);
    await store.flush();
    const restored = new SessionStore(root);
    await restored.initialize();
    expect(restored.get(record.id).title).toBe("later");
  });
});
