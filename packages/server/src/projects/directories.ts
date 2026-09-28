/**
 * Which directories are projects. A session runs in a directory; that
 * directory is a project unless the session was one without a folder — the
 * places apps put those — or the directory is gone.
 */

import { stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { isProfileDataDirName } from "@scholaraio-hub/shared";

/** A project's id: its path, base64url-encoded, so it survives a URL and decodes back. */
export function projectId(directory: string): string {
  return Buffer.from(directory).toString("base64url");
}

/** The path a project id stands for; undefined for an id that is not one. */
export function projectPath(id: string): string | undefined {
  const directory = Buffer.from(id, "base64url").toString();
  return path.isAbsolute(directory) && projectId(directory) === id ? directory : undefined;
}

export interface DirectoryRulesOptions {
  home: string;
  /** This Hub's data directory; sessions without a project run inside it. */
  dataDir: string;
  /** Temporary directories, where tools put throwaway workspaces; the system's by default. */
  temporary?: string[];
}

/**
 * Where apps keep sessions started without a folder, below the home directory:
 * the Claude desktop app's scratch workspaces, and the Codex app's dated
 * chat folders.
 */
const PROJECTLESS_UNDER_HOME = [
  ["Library", "Application Support", "Claude", "scratch-workspaces"],
  ["AppData", "Roaming", "Claude", "scratch-workspaces"],
  [".config", "Claude", "scratch-workspaces"],
  ["Documents", "Codex"],
];

/** Temporary directories, under both names macOS gives them. */
const TEMPORARY = [os.tmpdir(), "/tmp", "/private/tmp", "/var/folders", "/private/var/folders"];

export class DirectoryRules {
  private readonly home: string;
  private readonly projectless: string[];

  constructor({ home, dataDir, temporary = TEMPORARY }: DirectoryRulesOptions) {
    this.home = path.resolve(home);
    this.projectless = [
      path.resolve(dataDir),
      ...temporary.map((directory) => path.resolve(directory)),
      ...PROJECTLESS_UNDER_HOME.map((parts) => path.join(this.home, ...parts)),
    ];
  }

  /**
   * Whether a session in `directory` belongs to no project: the file-system
   * root or the home directory itself, a temporary directory, a Hub data
   * directory (any profile's), or where an app keeps folderless chats.
   */
  isProjectless(directory: string): boolean {
    const resolved = path.resolve(directory);
    if (resolved === path.parse(resolved).root || resolved === this.home) return true;
    if (this.projectless.some((root) => within(resolved, root))) return true;
    const relative = path.relative(this.home, resolved);
    const top = relative.split(path.sep)[0] ?? "";
    return !relative.startsWith("..") && isProfileDataDirName(top);
  }
}

function within(directory: string, root: string): boolean {
  const relative = path.relative(root, directory);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Whether `directory` exists and is a directory. */
export async function isDirectory(directory: string): Promise<boolean> {
  try {
    return (await stat(directory)).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}
