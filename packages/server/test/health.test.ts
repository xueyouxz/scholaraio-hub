import { describe, expect, it } from "vitest";
import { health } from "../src/routes/health.js";

describe("GET /health", () => {
  it("returns ok status", async () => {
    const res = await health.request("/");
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe("ok");
    expect(json.timestamp).toBeDefined();
  });
});
