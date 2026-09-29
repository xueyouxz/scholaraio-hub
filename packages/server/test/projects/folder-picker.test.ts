import { afterEach, describe, expect, it } from "vitest";
import {
  type FolderDialog,
  FolderPickerError,
  SystemFolderPicker,
  systemFolderDialog,
} from "../../src/projects/FolderPicker.js";

/** A dialog played by a Node script: what it prints, and how it exits. */
const script = (source: string, cancelled: FolderDialog["cancelled"] = () => false) => ({
  command: process.execPath,
  args: ["-e", source],
  cancelled,
});

describe("the system folder dialog", () => {
  let picker: SystemFolderPicker | undefined;
  afterEach(() => picker?.close());

  const choose = (dialog: FolderDialog | undefined, signal = new AbortController().signal) => {
    picker = new SystemFolderPicker(dialog);
    return picker.choose(signal);
  };

  it("gives the folder chosen, keeping spaces at the end of its name", async () => {
    expect(await choose(script(`process.stdout.write("/work/my app /\\n")`))).toBe(
      "/work/my app /",
    );
  });

  it("gives null when the person cancels", async () => {
    // Windows' dialog prints nothing; macOS and Linux exit with an error of their own.
    expect(await choose(script("process.exit(0)"))).toBeNull();
    const userCanceled = script(
      `process.stderr.write("execution error: User canceled. (-128)"); process.exit(1)`,
      (_code, stderr) => stderr.includes("(-128)"),
    );
    expect(await choose(userCanceled)).toBeNull();
  });

  it("reports a dialog that failed, and one that is not installed", async () => {
    await expect(
      choose(script(`process.stderr.write("no display"); process.exit(2)`)),
    ).rejects.toThrow("The folder dialog failed: no display");
    await expect(
      choose({ command: "hub-no-such-dialog", args: [], cancelled: () => false }),
    ).rejects.toBeInstanceOf(FolderPickerError);
    await expect(choose(undefined)).rejects.toBeInstanceOf(FolderPickerError);
  });

  it("opens one dialog at a time, and closes it when the request goes away", async () => {
    const controller = new AbortController();
    const open = choose(script("setInterval(() => {}, 1000)"), controller.signal);
    await expect(picker?.choose(new AbortController().signal)).rejects.toThrow(
      "A folder dialog is already open.",
    );
    controller.abort();
    expect(await open).toBeNull();
    // Closed, so the next request may open one again.
    await expect(picker?.choose(AbortSignal.abort())).resolves.toBeNull();
  });

  it("has a dialog on each desktop system", () => {
    expect(systemFolderDialog("darwin")?.command).toBe("osascript");
    expect(systemFolderDialog("win32")?.command).toBe("powershell.exe");
    expect(systemFolderDialog("linux")?.command).toBe("zenity");
    expect(systemFolderDialog("aix")).toBeUndefined();
  });
});
