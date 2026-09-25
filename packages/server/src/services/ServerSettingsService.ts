/**
 * ServerSettingsService - Manages server-wide settings that persist across restarts
 *
 * Only what the session flow needs: the new-session form's defaults.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { NewSessionDefaults } from "@scholaraio-hub/shared";

const CURRENT_VERSION = 1;

export interface ServerSettings {
  /** Defaults applied when opening the new session form */
  newSessionDefaults?: NewSessionDefaults;
}

const DEFAULT_SERVER_SETTINGS: ServerSettings = {};

interface SettingsState {
  version: number;
  settings: ServerSettings;
}

export interface ServerSettingsServiceOptions {
  dataDir: string;
}

export class ServerSettingsService {
  private state: SettingsState;
  private dataDir: string;
  private filePath: string;
  private initialized = false;
  private savePromise: Promise<void> | null = null;
  private pendingSave = false;

  constructor(options: ServerSettingsServiceOptions) {
    this.dataDir = options.dataDir;
    this.filePath = path.join(this.dataDir, "server-settings.json");
    this.state = {
      version: CURRENT_VERSION,
      settings: DEFAULT_SERVER_SETTINGS,
    };
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await fs.mkdir(this.dataDir, { recursive: true });

      const content = await fs.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(content) as SettingsState;

      if (parsed.version === CURRENT_VERSION) {
        this.state = {
          version: CURRENT_VERSION,
          settings: { ...DEFAULT_SERVER_SETTINGS, ...parsed.settings },
        };
      } else {
        this.state = {
          version: CURRENT_VERSION,
          settings: { ...DEFAULT_SERVER_SETTINGS, ...parsed.settings },
        };
        await this.save();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        console.warn("[ServerSettingsService] Failed to load settings, using defaults:", error);
      }
      this.state = {
        version: CURRENT_VERSION,
        settings: DEFAULT_SERVER_SETTINGS,
      };
    }

    this.initialized = true;
  }

  getSettings(): ServerSettings {
    this.ensureInitialized();
    return { ...this.state.settings };
  }

  async updateSettings(updates: Partial<ServerSettings>): Promise<ServerSettings> {
    this.ensureInitialized();

    this.state.settings = {
      ...this.state.settings,
      ...updates,
    };

    await this.save();
    return { ...this.state.settings };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("ServerSettingsService not initialized. Call initialize() first.");
    }
  }

  private async save(): Promise<void> {
    if (this.savePromise) {
      this.pendingSave = true;
      return;
    }

    this.savePromise = this.doSave();
    await this.savePromise;
    this.savePromise = null;

    if (this.pendingSave) {
      this.pendingSave = false;
      await this.save();
    }
  }

  private async doSave(): Promise<void> {
    try {
      const content = JSON.stringify(this.state, null, 2);
      await fs.writeFile(this.filePath, content, "utf-8");
    } catch (error) {
      console.error("[ServerSettingsService] Failed to save settings:", error);
      throw error;
    }
  }
}
