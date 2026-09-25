import { spawn } from "node:child_process";
import { loggerFor } from "../logging/logger.js";

/** The platform's file manager, and how it is told to show a directory. */
function revealCommand(directory: string): [string, string[]] {
  if (process.platform === "darwin") return ["open", [directory]];
  if (process.platform === "win32") return ["explorer.exe", [directory]];
  return ["xdg-open", [directory]];
}

/**
 * Show a directory in the desktop's file manager.
 *
 * Callers pass a path the server itself owns — never one from a request — so
 * there is nothing here to escape from.
 */
export function openInFileManager(directory: string): void {
  const [command, args] = revealCommand(directory);
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", (error) => {
    loggerFor("reveal").error({ err: error, directory }, "Could not open the directory");
  });
  child.unref();
}
