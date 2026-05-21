import { readdir, stat } from "node:fs/promises";
import { normalize, resolve, sep } from "node:path";
import { Hono } from "hono";

export interface FsEntry {
  name: string;
  isDir: boolean;
}

export interface FsBrowseResponse {
  path: string;
  entries: FsEntry[];
}

function isSafe(resolved: string): boolean {
  // Reject hidden directory components (any segment starting with ".")
  return !resolved.split(sep).some((part) => part.startsWith(".") && part !== "." && part !== "..");
}

export function createFsRoutes(): Hono {
  const app = new Hono();

  app.get("/browse", async (c) => {
    const rawPath = c.req.query("path") ?? "/";

    // Reject path traversal attempts before resolution
    if (rawPath.includes("..")) {
      return c.json({ error: "Path traversal not allowed" }, 400);
    }

    const resolvedPath = resolve(normalize(rawPath));

    // Reject hidden path components
    if (!isSafe(resolvedPath)) {
      return c.json({ error: "Hidden paths are not accessible" }, 400);
    }

    let st: Awaited<ReturnType<typeof stat>>;
    try {
      st = await stat(resolvedPath);
    } catch {
      return c.json({ error: "Path not found" }, 404);
    }

    if (!st.isDirectory()) {
      return c.json({ error: "Path is not a directory" }, 400);
    }

    let names: string[];
    try {
      names = await readdir(resolvedPath);
    } catch {
      return c.json({ error: "Permission denied" }, 403);
    }

    // Stat each entry; only include directories, skip hidden
    const entries: FsEntry[] = [];
    await Promise.all(
      names
        .filter((name) => !name.startsWith("."))
        .map(async (name) => {
          try {
            const entryStat = await stat(`${resolvedPath}${sep}${name}`);
            if (entryStat.isDirectory()) {
              entries.push({ name, isDir: true });
            }
          } catch {
            // skip unreadable entries
          }
        }),
    );

    entries.sort((a, b) => a.name.localeCompare(b.name));

    return c.json({ path: resolvedPath, entries } satisfies FsBrowseResponse);
  });

  return app;
}
