import type { NewSessionDefaults } from "@scholaraio-hub/shared";
import { queryOptions } from "@tanstack/react-query";
import { hubHttp } from "./http";

/** 读取和保存应用的新会话默认设置。 */
export const settingsApi = {
  get: (signal?: AbortSignal) =>
    hubHttp.json<{ settings: { newSessionDefaults?: NewSessionDefaults } }>("/settings", {
      signal,
    }),
  save: (newSessionDefaults: NewSessionDefaults) =>
    hubHttp.json<{ settings: { newSessionDefaults?: NewSessionDefaults } }>("/settings", {
      method: "PUT",
      json: { newSessionDefaults },
    }),
};
/** 定义应用设置查询。 */
export const appSettingsQuery = queryOptions({
  queryKey: ["app-settings"],
  queryFn: ({ signal }) => settingsApi.get(signal),
});
