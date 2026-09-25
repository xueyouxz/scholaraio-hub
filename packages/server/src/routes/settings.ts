/**
 * Server settings API routes
 *
 * Phase 4 MVP trim: keep only new session defaults and global instructions.
 */

import {
  ALL_PERMISSION_MODES,
  type NewSessionDefaults,
  type PermissionMode,
} from "@scholaraio-hub/shared";
import { Hono } from "hono";
import type { ServerSettings, ServerSettingsService } from "../services/ServerSettingsService.js";

export interface SettingsRoutesDeps {
  serverSettingsService: ServerSettingsService;
}

function parseNewSessionDefaults(raw: unknown): NewSessionDefaults | undefined | null {
  if (raw === undefined) return null;
  if (raw === null || raw === "") return undefined;
  if (typeof raw !== "object") return null;

  const input = raw as Record<string, unknown>;
  const parsed: NewSessionDefaults = {};

  if ("provider" in input) {
    if (
      input.provider !== undefined &&
      input.provider !== null &&
      input.provider !== "" &&
      input.provider !== "claude" &&
      input.provider !== "codex"
    ) {
      return null;
    }
    if (typeof input.provider === "string" && input.provider.length > 0) {
      parsed.provider = input.provider as "claude" | "codex";
    }
  }

  if ("model" in input) {
    if (
      input.model !== undefined &&
      input.model !== null &&
      input.model !== "" &&
      typeof input.model !== "string"
    ) {
      return null;
    }
    if (typeof input.model === "string" && input.model.length > 0) {
      parsed.model = input.model;
    }
  }

  if ("permissionMode" in input) {
    if (
      input.permissionMode !== undefined &&
      input.permissionMode !== null &&
      input.permissionMode !== "" &&
      !ALL_PERMISSION_MODES.includes(input.permissionMode as PermissionMode)
    ) {
      return null;
    }
    if (typeof input.permissionMode === "string" && input.permissionMode.length > 0) {
      parsed.permissionMode = input.permissionMode as PermissionMode;
    }
  }

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

export function createSettingsRoutes(deps: SettingsRoutesDeps): Hono {
  const app = new Hono();
  const { serverSettingsService } = deps;

  app.get("/", (c) => {
    const settings = serverSettingsService.getSettings();
    return c.json({ settings });
  });

  app.put("/", async (c) => {
    const body = await c.req.json<Partial<ServerSettings>>();
    const updates: Partial<ServerSettings> = {};

    if ("newSessionDefaults" in body) {
      const parsedDefaults = parseNewSessionDefaults(body.newSessionDefaults);
      if (parsedDefaults === null) {
        return c.json({ error: "Invalid newSessionDefaults setting" }, 400);
      }
      updates.newSessionDefaults = parsedDefaults;
    }

    if (Object.keys(updates).length === 0) {
      return c.json({ error: "At least one valid setting is required" }, 400);
    }

    const settings = await serverSettingsService.updateSettings(updates);
    return c.json({ settings });
  });

  return app;
}
