/**
 * Server settings API routes
 *
 * Phase 4 MVP trim: keep only new session defaults and global instructions.
 */

import { zValidator } from "@hono/zod-validator";
import { ALL_PERMISSION_MODES, type NewSessionDefaults } from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { z } from "zod";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";

export interface SettingsRoutesDeps {
  serverSettingsService: ServerSettingsService;
}

/** A blank field (null or "") means the same as an absent one. */
const blank = (value: unknown) => (value === null || value === "" ? undefined : value);

const SettingsUpdateSchema = z.object({
  // null or "" clears the saved defaults.
  newSessionDefaults: z
    .union([
      z.null(),
      z.literal(""),
      z.object({
        provider: z.preprocess(blank, z.enum(["claude", "codex"]).optional()),
        model: z.preprocess(blank, z.string().optional()),
        permissionMode: z.preprocess(blank, z.enum(ALL_PERMISSION_MODES).optional()),
      }),
    ])
    .optional(),
});

/** The fields actually set, or undefined when none are. */
function savedDefaults(input: NewSessionDefaults | null | ""): NewSessionDefaults | undefined {
  if (!input) return undefined;
  const defaults = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

export function createSettingsRoutes(deps: SettingsRoutesDeps): Hono {
  const app = new Hono();
  const { serverSettingsService } = deps;

  app.get("/", (c) => {
    const settings = serverSettingsService.getSettings();
    return c.json({ settings });
  });

  app.put(
    "/",
    zValidator("json", SettingsUpdateSchema, (result, c) => {
      if (!result.success) return c.json({ error: "Invalid newSessionDefaults setting" }, 400);
    }),
    async (c) => {
      const { newSessionDefaults } = c.req.valid("json");
      if (newSessionDefaults === undefined)
        return c.json({ error: "At least one valid setting is required" }, 400);
      const settings = await serverSettingsService.updateSettings({
        newSessionDefaults: savedDefaults(newSessionDefaults),
      });
      return c.json({ settings });
    },
  );

  return app;
}
