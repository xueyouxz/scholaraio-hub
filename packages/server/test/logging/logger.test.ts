import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("logger defaults", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("node:fs");
    vi.resetModules();
  });

  it("disables file logging by default in test environment", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("VITEST", "true");
    vi.stubEnv("LOG_TO_FILE", undefined);

    const createWriteStream = vi.fn();
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return {
        ...actual,
        createWriteStream,
      };
    });

    const loggerModule = await import("../../src/logging/logger.js");
    const logger = loggerModule.getLogger();

    expect(logger).toBeDefined();
    expect(createWriteStream).not.toHaveBeenCalled();
  });

  it("still honors explicit initLogger file config when requested", async () => {
    const createWriteStream = vi.fn((_path: string) => new PassThrough());
    vi.doMock("node:fs", async () => {
      const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
      return { ...actual, mkdirSync: vi.fn(), createWriteStream };
    });

    const loggerModule = await import("../../src/logging/logger.js");
    loggerModule.initLogger({ logToFile: true, logDir: "/tmp/hub-logs" });

    expect(createWriteStream).toHaveBeenCalledTimes(1);
    expect(createWriteStream.mock.calls[0]?.[0]).toBe("/tmp/hub-logs/server.log");
  });
});
