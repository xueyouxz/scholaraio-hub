import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SessionStore } from "../../src/sessions/SessionStore.js";

const ATTACHMENTS = "3f2b7c1e-0000-4000-8000-000000000000";

describe("SessionStore", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-store-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("keeps one record per provider session, and sets an unreadable one aside", async () => {
    const store = new SessionStore(root);
    await store.initialize();
    const good = await store.create({
      provider: "claude",
      nativeId: "s1",
      cwd: "/w",
      attachments: ATTACHMENTS,
    });
    expect(
      await store.create({
        provider: "claude",
        nativeId: "s1",
        cwd: "/x",
        attachments: ATTACHMENTS,
      }),
    ).toBe(good);
    const folder = join(root, "session-records", "codex");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "broken.json"), "{ not json");

    const restored = new SessionStore(root);
    await restored.initialize();

    expect(restored.find("claude:s1")).toMatchObject({ cwd: "/w" });
    expect(restored.find("codex:broken")).toBeUndefined();
    const files = await readdir(folder);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^broken\.json\.corrupt-\d+$/);
  });

  it("reports each failed write to its caller and keeps writing after it", async () => {
    const store = new SessionStore(root);
    await store.initialize();
    const record = await store.create({
      provider: "codex",
      nativeId: "t1",
      cwd: "/w",
      attachments: ATTACHMENTS,
    });
    await rm(join(root, "session-records"), { recursive: true });
    await writeFile(join(root, "session-records"), "not a folder");
    await expect(store.save(record)).rejects.toThrow();
    await rm(join(root, "session-records"));
    record.title = "later";
    await store.save(record);
    await store.flush();
    const restored = new SessionStore(root);
    await restored.initialize();
    expect(restored.find("codex:t1")?.title).toBe("later");
  });
});
