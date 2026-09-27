import { launch } from "../launch.js";

/** Production: the library service and the built server, serving the built client. */
export function start(): Promise<number> {
  return launch("production");
}
