import { mkdir, readFile, rename } from "node:fs/promises";
import * as path from "node:path";
import type { NewSessionDefaults } from "@scholaraio-hub/shared";
import { loggerFor } from "../logging/logger.js";
import { writeFileAtomic } from "../utils/write-file-atomic.js";

const CURRENT_VERSION = 1;

/** Server-wide settings that persist across restarts. */
export interface ServerSettings {
  /** Defaults applied when opening the new session form */
  newSessionDefaults?: NewSessionDefaults;
}

export interface ServerSettingsServiceOptions {
  dataDir: string;
}

/** Only what the session flow needs: the new-session form's defaults. */
export class ServerSettingsService {
  private settings: ServerSettings = {};
  private readonly filePath: string;
  private initialized = false;
  /** Saves go out one after another, so the file ends with the last one. */
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly options: ServerSettingsServiceOptions) {
    this.filePath = path.join(options.dataDir, "server-settings.json");
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await mkdir(this.options.dataDir, { recursive: true });
    let content: string | undefined;
    try {
      content = await readFile(this.filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (content !== undefined) {
      try {
        const parsed = JSON.parse(content) as { version?: number; settings?: ServerSettings };
        this.settings = { ...parsed.settings };
        if (parsed.version !== CURRENT_VERSION) await this.save();
      } catch (error) {
        // Keep the user's file for inspection instead of overwriting it with defaults.
        const aside = `${this.filePath}.corrupt-${Date.now()}`;
        await rename(this.filePath, aside);
        loggerFor("settings").error(
          { err: error, movedTo: aside },
          "Unreadable settings set aside",
        );
      }
    }
    this.initialized = true;
  }

  getSettings(): ServerSettings {
    this.ensureInitialized();
    return { ...this.settings };
  }

  async updateSettings(updates: Partial<ServerSettings>): Promise<ServerSettings> {
    this.ensureInitialized();
    this.settings = { ...this.settings, ...updates };
    await this.save();
    return { ...this.settings };
  }

  /** 等待已排队的保存写完，关闭时调用。 */
  async close(): Promise<void> {
    await this.writes;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("ServerSettingsService not initialized. Call initialize() first.");
    }
  }

  /** Persist the settings as they are now; resolves once they are on disk. */
  private save(): Promise<void> {
    const content = JSON.stringify({ version: CURRENT_VERSION, settings: this.settings }, null, 2);
    const next = this.writes.then(() => writeFileAtomic(this.filePath, content));
    // Later saves wait on this one either way; its caller hears whether it failed.
    this.writes = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}
