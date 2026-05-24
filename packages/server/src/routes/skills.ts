import { Hono } from "hono";
import { getCategoryList } from "../skills/scholaraioCategories.js";
import {
  getScholaraioSkill,
  invalidateScholaraioSkillsCache,
  listScholaraioSkills,
} from "../skills/scholaraioSkills.js";

export interface SkillsRoutesDeps {
  scholaraioSkillsDir: string;
}

export function createSkillsRoutes(deps: SkillsRoutesDeps) {
  const app = new Hono();

  app.get("/scholaraio", async (c) => {
    const skills = await listScholaraioSkills(deps.scholaraioSkillsDir);
    return c.json({ categories: getCategoryList(), skills });
  });

  app.get("/scholaraio/:name", async (c) => {
    const name = c.req.param("name");
    const skill = await getScholaraioSkill(deps.scholaraioSkillsDir, name);
    if (!skill) return c.json({ error: "not_found" }, 404);
    return c.json(skill);
  });

  app.post("/scholaraio/refresh", async (c) => {
    invalidateScholaraioSkillsCache();
    const skills = await listScholaraioSkills(deps.scholaraioSkillsDir);
    return c.json({ refreshed: true, count: skills.length });
  });

  return app;
}
