import {
  ALL_PERMISSION_MODES,
  type NewSessionDefaults,
  PROVIDER_NAMES,
} from "@scholaraio-hub/shared";
import { Hono } from "hono";
import { z } from "zod";
import { ApiError, success, validate } from "../http.js";
import type { ServerSettingsService } from "../services/ServerSettingsService.js";

export interface SettingsRoutesDeps {
  serverSettingsService: ServerSettingsService;
}

/** 将空字段转换为未设置状态。 */
const blank = (value: unknown) => (value === null || value === "" ? undefined : value);

const SETTINGS_UPDATE_SCHEMA = z.object({
  // null 或空字符串表示清除默认设置。
  newSessionDefaults: z
    .union([
      z.null(),
      z.literal(""),
      z.object({
        provider: z.preprocess(blank, z.enum(PROVIDER_NAMES).optional()),
        model: z.preprocess(blank, z.string().optional()),
        permissionMode: z.preprocess(blank, z.enum(ALL_PERMISSION_MODES).optional()),
      }),
    ])
    .optional(),
});

/** 提取已设置的默认值；全部为空时返回未设置状态。 */
function savedDefaults(input: NewSessionDefaults | null | ""): NewSessionDefaults | undefined {
  if (!input) return undefined;
  const defaults = Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

/** 创建应用设置的读取与更新接口。 */
export function createSettingsRoutes(deps: SettingsRoutesDeps): Hono {
  const app = new Hono();
  const { serverSettingsService } = deps;

  app.get("/", (c) => {
    const settings = serverSettingsService.getSettings();
    return success(c, { settings });
  });

  app.put("/", validate("json", SETTINGS_UPDATE_SCHEMA), async (c) => {
    const { newSessionDefaults } = c.req.valid("json");
    if (newSessionDefaults === undefined)
      throw new ApiError("VALIDATION_FAILED", "Provide at least one setting.");
    const settings = await serverSettingsService.updateSettings({
      newSessionDefaults: savedDefaults(newSessionDefaults),
    });
    return success(c, { settings });
  });

  return app;
}
