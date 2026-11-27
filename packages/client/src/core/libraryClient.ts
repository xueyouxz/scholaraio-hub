import type { LibraryPaths } from "@scholaraio-hub/shared";
import { type HttpClient, libraryHttp } from "./http";

type Method = "get" | "post" | "put" | "patch" | "delete";

/** 从成功响应模型中提取业务数据。 */
type ResponseData<Operation> = Operation extends { responses: infer Responses }
  ? {
      [Status in keyof Responses]: `${Status & (string | number)}` extends `2${string}`
        ? Responses[Status] extends {
            content: { "application/json": { code: "success"; data: infer Data } };
          }
          ? Data
          : never
        : never;
    }[keyof Responses]
  : never;

/** 仅选择指定方法具有 JSON 业务响应的路径。 */
type ResourcePath<M extends Method> = {
  [Path in keyof LibraryPaths]: [ResponseData<LibraryPaths[Path][M]>] extends [never]
    ? never
    : Path;
}[keyof LibraryPaths];

type BodyOptions<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? { body: Body; form?: never }
  : Operation extends { requestBody: { content: { "multipart/form-data": unknown } } }
    ? { form: FormData; body?: never }
    : { body?: never; form?: never };

type Options<Operation> = Operation extends { parameters: infer Parameters }
  ? Pick<Parameters, Extract<keyof Parameters, "path" | "query">> &
      BodyOptions<Operation> & {
        signal?: AbortSignal;
        timeoutMs?: number | null;
      }
  : never;

type Arguments<Operation> = Record<never, never> extends Options<Operation>
  ? [options?: Options<Operation>]
  : [options: Options<Operation>];

interface RuntimeOptions {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  form?: FormData;
  signal?: AbortSignal;
  timeoutMs?: number | null;
}

/** 创建受文献 OpenAPI 路径、参数和响应类型约束的客户端。 */
export function createLibraryClient(http: HttpClient = libraryHttp) {
  return {
    /** 编码路径与查询参数，发送请求并解包领域数据。 */
    request<M extends Method, P extends ResourcePath<M>>(
      method: M,
      resource: P,
      ...args: Arguments<LibraryPaths[NoInfer<P>][M]>
    ): Promise<ResponseData<LibraryPaths[P][M]>> {
      const options: RuntimeOptions = args[0] ?? {};
      const path = resource.replace(/\{([^}]+)\}/g, (_, name: string) => {
        const value = options.path?.[name];
        if (value === undefined) throw new Error(`Missing path parameter: ${name}`);
        return encodeURIComponent(String(value));
      });
      const query = new URLSearchParams();
      for (const [name, value] of Object.entries(options.query ?? {})) {
        if (value === undefined || value === null) continue;
        for (const item of Array.isArray(value) ? value : [value]) query.append(name, String(item));
      }
      const url = `${path}${query.size ? `?${query}` : ""}`;
      const payload = options.form ? { body: options.form } : { json: options.body };
      return http.json(url, {
        method: method.toUpperCase(),
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        ...payload,
      });
    },
  };
}

export const libraryClient = createLibraryClient();
