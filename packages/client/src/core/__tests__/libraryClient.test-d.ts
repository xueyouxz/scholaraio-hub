import type { LiteratureProject } from "@scholaraio-hub/shared";
import { expectTypeOf } from "vitest";
import type { libraryClient } from "../libraryClient";

type CreateOptions = Parameters<typeof libraryClient.request<"post", "/projects">>[2];
type DetailOptions = Parameters<typeof libraryClient.request<"get", "/papers/{paper_id}">>[2];
type TaskOptions = Parameters<typeof libraryClient.request<"post", "/tasks/{kind}">>[2];
type CreateResult = Awaited<ReturnType<typeof libraryClient.request<"post", "/projects">>>;

expectTypeOf<CreateResult>().toEqualTypeOf<LiteratureProject>();
expectTypeOf<{ body: { name: string } }>().toMatchTypeOf<CreateOptions>();
expectTypeOf<Record<string, never>>().not.toMatchTypeOf<CreateOptions>();
expectTypeOf<{ body: { name: number } }>().not.toMatchTypeOf<CreateOptions>();
expectTypeOf<Record<string, never>>().not.toMatchTypeOf<DetailOptions>();
expectTypeOf<{ path: { paper_id: string } }>().toMatchTypeOf<DetailOptions>();
expectTypeOf<{ path: { kind: number } }>().not.toMatchTypeOf<TaskOptions>();
