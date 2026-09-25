import path from "node:path";
import { describe, expect, it } from "vitest";
import { pythonRuntime } from "../src/python.js";

describe("pythonRuntime", () => {
  it("keeps the environment under the data directory", () => {
    const runtime = pythonRuntime("/data", "darwin");
    expect(runtime.root).toBe("/data/runtime/python");
    expect(runtime.uvCacheDir).toBe("/data/data/cache/uv");
    expect(runtime.executable).toBe("/data/runtime/python/bin/python");
    expect(runtime.command("mineru-open-api")).toBe("/data/runtime/python/bin/mineru-open-api");
  });

  it("uses the Windows virtual environment layout", () => {
    const runtime = pythonRuntime("C:\\data", "win32");
    expect(runtime.executable).toBe(
      path.win32.join("C:\\data", "runtime/python/Scripts/python.exe"),
    );
    expect(runtime.command("scholaraio")).toBe(
      path.win32.join("C:\\data", "runtime/python/Scripts/scholaraio.exe"),
    );
  });

  it("activates the environment for the processes it starts", () => {
    const env = pythonRuntime("/data", "darwin").env({
      PATH: "/usr/bin",
      PYTHONHOME: "/elsewhere",
    });
    expect(env.PATH).toBe("/data/runtime/python/bin:/usr/bin");
    expect(env.VIRTUAL_ENV).toBe("/data/runtime/python");
    expect(env.PYTHONHOME).toBeUndefined();
  });

  it("keeps the caller's spelling of PATH", () => {
    const env = pythonRuntime("C:\\data", "win32").env({ Path: "C:\\Windows" });
    expect(env.Path).toBe(`${path.win32.join("C:\\data", "runtime/python/Scripts")};C:\\Windows`);
    expect(env).not.toHaveProperty("PATH");
  });

  it("works without an inherited PATH", () => {
    expect(pythonRuntime("/data", "linux").env({}).PATH).toBe("/data/runtime/python/bin");
  });
});
