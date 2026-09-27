import { LibraryClient } from "../../src/lib/LibraryClient.js";

/** An address nothing listens on: tests that fake the library override `request`. */
export const TEST_LIBRARY_URL = "http://127.0.0.1:9";

/** A library service that is not running. */
export function offlineLibrary(): LibraryClient {
  return new LibraryClient(TEST_LIBRARY_URL);
}

/** 生成文献服务测试替身的统一响应。 */
export function libraryResponse(data: unknown, init?: ResponseInit): Response {
  const failure = typeof data === "object" && data !== null && "error" in data;
  return Response.json(
    {
      id: "test-library-request",
      code: failure
        ? init?.status === 404
          ? "RESOURCE_NOT_FOUND"
          : "VALIDATION_FAILED"
        : "success",
      message: failure ? String(data.error) : "success",
      data: failure ? null : data,
    },
    init,
  );
}
