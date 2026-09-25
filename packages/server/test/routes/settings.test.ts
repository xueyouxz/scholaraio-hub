import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSettingsRoutes } from "../../src/routes/settings.js";
import type {
  ServerSettings,
  ServerSettingsService,
} from "../../src/services/ServerSettingsService.js";

describe("Settings Routes", () => {
  let settings: ServerSettings;
  let mockServerSettingsService: ServerSettingsService;

  beforeEach(() => {
    settings = {};

    mockServerSettingsService = {
      getSettings: vi.fn(() => settings),
      updateSettings: vi.fn(async (updates: Partial<ServerSettings>) => {
        settings = { ...settings, ...updates };
        return settings;
      }),
    } as unknown as ServerSettingsService;
  });

  describe("PUT /", () => {
    it("accepts valid newSessionDefaults", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newSessionDefaults: {
            provider: "codex",
            model: "gpt-5",
            permissionMode: "acceptEdits",
          },
        }),
      });

      expect(response.status).toBe(200);
      expect(mockServerSettingsService.updateSettings).toHaveBeenCalledWith({
        newSessionDefaults: {
          provider: "codex",
          model: "gpt-5",
          permissionMode: "acceptEdits",
        },
      });
    });

    it("rejects invalid newSessionDefaults", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });

      const response = await routes.request("/", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newSessionDefaults: {
            provider: "bad-provider",
          },
        }),
      });

      expect(response.status).toBe(400);
      const json = await response.json();
      expect(json.error).toBe("Invalid newSessionDefaults setting");
    });

    it("treats blank fields as absent and clears the defaults when none are left", async () => {
      const routes = createSettingsRoutes({
        serverSettingsService: mockServerSettingsService,
      });
      const put = (body: unknown) =>
        routes.request("/", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

      expect((await put({ newSessionDefaults: { provider: "", model: "m" } })).status).toBe(200);
      expect(mockServerSettingsService.updateSettings).toHaveBeenLastCalledWith({
        newSessionDefaults: { model: "m" },
      });
      for (const newSessionDefaults of [null, "", { provider: null, model: "" }]) {
        expect((await put({ newSessionDefaults })).status).toBe(200);
        expect(settings.newSessionDefaults).toBeUndefined();
      }
      const missing = await put({});
      expect(missing.status).toBe(400);
      expect((await missing.json()).error).toBe("At least one valid setting is required");
    });
  });
});
