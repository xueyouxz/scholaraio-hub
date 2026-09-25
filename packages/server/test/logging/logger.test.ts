import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

/** A destination that keeps each JSON line pino writes. */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(JSON.parse(String(chunk)));
      done();
    },
  });
  return { lines, stream };
}

describe("logger", () => {
  afterEach(() => {
    vi.resetModules();
  });

  it("gives component loggers taken before initialization the configured outputs", async () => {
    const { getLogger, initLogger, loggerFor } = await import("../../src/logging/logger.js");
    const before = loggerFor("codex");
    const { lines, stream } = capture();
    const root = initLogger({ consoleLevel: "debug" }, stream);
    expect(getLogger()).toBe(root);
    expect(loggerFor("codex")).not.toBe(before);
    loggerFor("codex").debug("configured");
    expect(lines).toEqual([expect.objectContaining({ component: "codex", msg: "configured" })]);
  });

  it("serializes an error under either key and redacts credentials", async () => {
    const { initLogger, loggerFor } = await import("../../src/logging/logger.js");
    const { lines, stream } = capture();
    initLogger({}, stream);
    loggerFor("test").error({ error: new Error("boom"), headers: { authorization: "Bearer x" } });
    loggerFor("test").error({ err: new Error("bang"), token: "secret" });
    expect(lines[0]).toMatchObject({
      error: { type: "Error", message: "boom" },
      headers: { authorization: "[redacted]" },
    });
    expect(lines[1]).toMatchObject({ err: { message: "bang" }, token: "[redacted]" });
  });
});
