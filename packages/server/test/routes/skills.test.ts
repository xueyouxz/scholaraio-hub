import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { handleApiError } from "../../src/http.js";
import { createSkillsRoutes } from "../../src/routes/skills.js";
import { invalidateScholaraioSkillsCache } from "../../src/skills/scholaraioSkills.js";

async function makeSkill(dir: string, name: string, description: string, body = "") {
  const skillDir = join(dir, name);
  await mkdir(skillDir, { recursive: true });
  const content = `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;
  await writeFile(join(skillDir, "SKILL.md"), content, "utf8");
}

describe("Skills Routes", () => {
  let tmp: string;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), "skills-test-"));
    invalidateScholaraioSkillsCache();
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    invalidateScholaraioSkillsCache();
  });

  it("returns categorized skill list", async () => {
    await makeSkill(tmp, "search", "search desc");
    await makeSkill(tmp, "ingest", "ingest desc");
    await makeSkill(tmp, "totally-new", "uncategorized");

    const routes = createSkillsRoutes({ scholaraioSkillsDir: tmp });
    routes.onError(handleApiError);
    const res = await routes.request("/scholaraio");
    expect(res.status).toBe(200);
    const data = (await res.json().then((body) => body.data)) as {
      categories: Array<{ id: string }>;
      skills: Array<{ name: string; category: string; source: string }>;
    };

    expect(data.categories.some((c) => c.id === "__uncategorized__")).toBe(true);
    const byName = new Map(data.skills.map((s) => [s.name, s]));
    expect(byName.get("search")?.category).toBe("discover");
    expect(byName.get("ingest")?.category).toBe("ingest");
    expect(byName.get("totally-new")?.category).toBe("__uncategorized__");
    for (const s of data.skills) expect(s.source).toBe("research");
  });

  it("says how many papers each skill works on", async () => {
    await makeSkill(tmp, "show", "one paper");
    await makeSkill(tmp, "literature-review", "several papers");
    await makeSkill(tmp, "search", "any papers");
    await makeSkill(tmp, "ingest", "no papers");

    const routes = createSkillsRoutes({ scholaraioSkillsDir: tmp });
    routes.onError(handleApiError);
    const res = await routes.request("/scholaraio");
    const data = (await res.json().then((body) => body.data)) as {
      skills: Array<{ name: string; papers?: string }>;
    };
    expect(Object.fromEntries(data.skills.map((s) => [s.name, s.papers]))).toEqual({
      show: "single",
      "literature-review": "multi",
      search: "any",
      ingest: undefined,
    });
  });

  it("returns skill detail with body", async () => {
    await makeSkill(tmp, "search", "search desc", "# Hello\nbody text");

    const routes = createSkillsRoutes({ scholaraioSkillsDir: tmp });
    routes.onError(handleApiError);
    const res = await routes.request("/scholaraio/search");
    expect(res.status).toBe(200);
    const data = (await res.json().then((body) => body.data)) as { body: string; path: string };
    expect(data.body).toContain("# Hello");
    expect(data.path.endsWith("/search/SKILL.md")).toBe(true);
  });

  it("404s unknown skill", async () => {
    const routes = createSkillsRoutes({ scholaraioSkillsDir: tmp });
    routes.onError(handleApiError);
    const res = await routes.request("/scholaraio/missing");
    expect(res.status).toBe(404);
  });

  it("refresh invalidates cache and rescans", async () => {
    const routes = createSkillsRoutes({ scholaraioSkillsDir: tmp });
    routes.onError(handleApiError);
    let res = await routes.request("/scholaraio");
    expect(
      ((await res.json().then((body) => body.data)) as { skills: unknown[] }).skills,
    ).toHaveLength(0);

    await makeSkill(tmp, "search", "search desc");
    const refresh = await routes.request("/scholaraio/refresh", { method: "POST" });
    expect(refresh.status).toBe(200);

    res = await routes.request("/scholaraio");
    expect(
      ((await res.json().then((body) => body.data)) as { skills: unknown[] }).skills,
    ).toHaveLength(1);
  });
});
