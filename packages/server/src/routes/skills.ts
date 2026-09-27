import { Hono } from "hono";
import { ApiError, type AppEnv, success } from "../http.js";
import { getCategoryList } from "../skills/scholaraioCategories.js";
import {
  getScholaraioSkill,
  invalidateScholaraioSkillsCache,
  listScholaraioSkills,
} from "../skills/scholaraioSkills.js";

export interface SkillsRoutesDeps {
  scholaraioSkillsDir: string;
}

/** 创建科研技能列表、详情和刷新接口。 */
export function createSkillsRoutes(deps: SkillsRoutesDeps) {
  const app = new Hono<AppEnv>();

  app.get("/scholaraio", async (c) => {
    const skills = await listScholaraioSkills(deps.scholaraioSkillsDir);
    return success(c, { categories: getCategoryList(), skills });
  });

  app.get("/scholaraio/:name", async (c) => {
    const name = c.req.param("name");
    const skill = await getScholaraioSkill(deps.scholaraioSkillsDir, name);
    if (!skill) throw new ApiError("SKILL_NOT_FOUND", "Research skill not found.");
    return success(c, skill);
  });

  app.post("/scholaraio/refresh", async (c) => {
    invalidateScholaraioSkillsCache();
    const skills = await listScholaraioSkills(deps.scholaraioSkillsDir);
    return success(c, { refreshed: true, count: skills.length });
  });

  return app;
}
