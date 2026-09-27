import type { ScholaraioSkillDetail, ScholaraioSkillsResponse } from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
import { hubHttp, pathSegment } from "./http";

/** 查询、读取和刷新科研技能。 */
export const skillsApi = {
  list: (signal?: AbortSignal) =>
    hubHttp.json<ScholaraioSkillsResponse>("/skills/scholaraio", { signal }),
  get: (name: string, signal?: AbortSignal) =>
    hubHttp.json<ScholaraioSkillDetail>(`/skills/scholaraio/${pathSegment(name)}`, { signal }),
  refresh: () =>
    hubHttp.json<{ refreshed: boolean; count: number }>("/skills/scholaraio/refresh", {
      method: "POST",
    }),
};

/** 定义科研技能列表查询。 */
export const skillsQuery = queryOptions({
  queryKey: ["scholaraio-skills"],
  queryFn: ({ signal }) => skillsApi.list(signal),
  staleTime: Number.POSITIVE_INFINITY,
});

/** 根据技能名称构造详情查询。 */
export const skillQuery = (name: string) =>
  queryOptions({
    queryKey: ["scholaraio-skills", name],
    queryFn: ({ signal }) => skillsApi.get(name, signal),
    staleTime: Number.POSITIVE_INFINITY,
  });
