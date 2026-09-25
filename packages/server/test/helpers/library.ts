import { LibraryClient } from "../../src/lib/LibraryClient.js";

/** An address nothing listens on: tests that fake the library override `request`. */
export const TEST_LIBRARY_URL = "http://127.0.0.1:9";

/** A library service that is not running. */
export function offlineLibrary(): LibraryClient {
  return new LibraryClient(TEST_LIBRARY_URL);
}
