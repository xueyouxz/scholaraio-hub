import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type HistoryChange, HistoryWatcher } from "../../src/projects/HistoryWatcher.js";
import { ProviderRegistry } from "../../src/providers/ProviderRegistry.js";
import { claudeHistoryFiles } from "../../src/providers/claude/history.js";
import { createScriptedProvider } from "../helpers/scriptedProvider.js";

const SESSION = "27ad8f51-1685-4bb6-8196-38d2007c4663";
const OWN = "3b1d2b4e-6294-4766-9f00-d58b441d9b5b";

describe("HistoryWatcher", () => {
  let root: string;
  let watcher: HistoryWatcher;
  const changes: HistoryChange[] = [];

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "hub-history-"));
    await mkdir(join(root, "projects", "-w-app"), { recursive: true });
    const provider = {
      ...createScriptedProvider(),
      historyFiles: () => claudeHistoryFiles({ CLAUDE_CONFIG_DIR: root }),
    };
    changes.length = 0;
    watcher = new HistoryWatcher({
      providers: new ProviderRegistry([provider]),
      // The Hub is running OWN itself; its writes are not someone else's.
      owns: (_, id) => id === OWN,
    });
    watcher.subscribe((change) => changes.push(change));
    await watcher.start();
  });

  afterEach(async () => {
    watcher.close();
    await rm(root, { recursive: true, force: true });
  });

  it("reports which sessions a CLI wrote to, and which of them another program runs", async () => {
    await writeFile(join(root, "projects", "-w-app", `${SESSION}.jsonl`), "{}\n");
    await writeFile(join(root, "projects", "-w-app", `${OWN}.jsonl`), "{}\n");
    await expect
      .poll(() => changes.flatMap((change) => change.sessions.map((session) => session.id)))
      .toEqual(expect.arrayContaining([SESSION, OWN]));
    expect(watcher.isExternal("claude", SESSION)).toBe(true);
    expect(watcher.isExternal("claude", OWN)).toBe(false);
  });

  it("stops listening once closed", async () => {
    watcher.close();
    await writeFile(join(root, "projects", "-w-app", `${SESSION}.jsonl`), "{}\n");
    // fs.watch delivers within a few milliseconds; 300 ms is past the debounce as well.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(changes).toEqual([]);
  });
});
