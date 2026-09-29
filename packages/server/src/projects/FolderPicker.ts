/**
 * The system's own "choose a folder" dialog, shown on the computer the Hub
 * runs on: the one its single user sits at.
 */

import { type ChildProcessByStdio, spawn } from "node:child_process";
import type { Readable } from "node:stream";

/** Asks the person at this computer to choose a folder. */
export interface FolderPicker {
  /** The folder chosen; null when the dialog was cancelled or `signal` aborted. */
  choose(signal: AbortSignal): Promise<string | null>;
  /** Close a dialog still open; called on shutdown. */
  close(): void;
}

/** No folder can be asked for: this system has no dialog, or one is already open. */
export class FolderPickerError extends Error {}

/**
 * A command that shows the dialog and prints the chosen folder. Cancelling
 * prints nothing, or fails in a way `cancelled` recognises.
 */
export interface FolderDialog {
  command: string;
  args: string[];
  /** Whether a failed run was the person cancelling rather than the dialog failing. */
  cancelled(code: number | null, stderr: string): boolean;
}

const PROMPT = "选择项目文件夹";

/** This platform's dialog, or undefined where there is none. */
export function systemFolderDialog(platform = process.platform): FolderDialog | undefined {
  switch (platform) {
    case "darwin":
      return {
        command: "osascript",
        // No `activate`: bringing osascript to the front takes about two seconds,
        // so the dialog opens at once but may sit behind the browser.
        args: ["-e", `POSIX path of (choose folder with prompt "${PROMPT}")`],
        // -128 is AppleScript's "User canceled".
        cancelled: (_code, stderr) => stderr.includes("(-128)"),
      };
    case "win32":
      return {
        command: "powershell.exe",
        args: [
          "-NoProfile",
          "-STA",
          "-Command",
          [
            "[Console]::OutputEncoding = [Text.Encoding]::UTF8",
            "Add-Type -AssemblyName System.Windows.Forms",
            "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
            `$dialog.Description = '${PROMPT}'`,
            "if ($dialog.ShowDialog() -eq 'OK') { $dialog.SelectedPath }",
          ].join("; "),
        ],
        cancelled: () => false,
      };
    case "linux":
      return {
        command: "zenity",
        args: ["--file-selection", "--directory", `--title=${PROMPT}`],
        cancelled: (code) => code === 1,
      };
    default:
      return undefined;
  }
}

/** One dialog at a time, closed with the request that opened it. */
export class SystemFolderPicker implements FolderPicker {
  private open?: ChildProcessByStdio<null, Readable, Readable>;

  /** `dialog` is this platform's (`systemFolderDialog()`); none where it has none. */
  constructor(private readonly dialog: FolderDialog | undefined) {}

  async choose(signal: AbortSignal): Promise<string | null> {
    const dialog = this.dialog;
    if (!dialog) throw new FolderPickerError("This system has no folder dialog the Hub can open.");
    if (this.open) throw new FolderPickerError("A folder dialog is already open.");
    if (signal.aborted) return null;
    const child = spawn(dialog.command, dialog.args, { stdio: ["ignore", "pipe", "pipe"] });
    this.open = child;
    // The page that asked went away, or timed out: its dialog goes with it.
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf-8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf-8");
    });
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", resolve);
      });
      if (signal.aborted) return null;
      // Only the line break goes: a folder's name may end in spaces.
      if (code === 0) return stdout.replace(/\r?\n$/, "") || null;
      if (dialog.cancelled(code, stderr)) return null;
      throw new Error(`The folder dialog failed: ${stderr.trim() || `exit code ${code}`}`);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        throw new FolderPickerError(`No folder dialog is available: ${dialog.command} is missing.`);
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
      if (this.open === child) this.open = undefined;
    }
  }

  close(): void {
    this.open?.kill();
  }
}
