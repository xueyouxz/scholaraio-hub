import { launch } from "../launch.js";

/** Development: the library service, and the server under `tsx watch` serving the client through Vite. */
export function dev(): Promise<number> {
  return launch("development");
}
