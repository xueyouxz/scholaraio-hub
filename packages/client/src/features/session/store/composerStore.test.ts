import { beforeEach, describe, expect, it } from "vitest";
import { useComposerStore } from "./composerStore";

function makeFile(name: string) {
  return new File(["x"], name, { type: "text/plain" });
}

describe("composerStore", () => {
  beforeEach(() => {
    useComposerStore.getState().reset();
  });

  it("starts with sane defaults", () => {
    const state = useComposerStore.getState();
    expect(state.message).toBe("");
    expect(state.thinking).toBe("auto");
    expect(state.permissionMode).toBe("default");
    expect(state.attachments).toEqual([]);
    expect(state.busy).toBe(false);
  });

  it("addFiles appends new attachments", () => {
    useComposerStore.getState().addFiles([makeFile("a.txt"), makeFile("b.txt")]);
    expect(useComposerStore.getState().attachments).toHaveLength(2);
    useComposerStore.getState().addFiles([makeFile("c.txt")]);
    expect(useComposerStore.getState().attachments).toHaveLength(3);
  });

  it("removeAttachment drops the indexed file", () => {
    useComposerStore.getState().addFiles([makeFile("a.txt"), makeFile("b.txt")]);
    useComposerStore.getState().removeAttachment(0);
    const remaining = useComposerStore.getState().attachments;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.file.name).toBe("b.txt");
  });

  it("toggleHold flips the hold flag", () => {
    expect(useComposerStore.getState().isHeld).toBe(false);
    useComposerStore.getState().toggleHold();
    expect(useComposerStore.getState().isHeld).toBe(true);
    useComposerStore.getState().toggleHold();
    expect(useComposerStore.getState().isHeld).toBe(false);
  });

  it("reset clears stateful fields", () => {
    const store = useComposerStore.getState();
    store.setMessage("hello");
    store.addFiles([makeFile("x.txt")]);
    store.setBusy(true);
    store.setSendError("oops");
    store.reset();
    const after = useComposerStore.getState();
    expect(after.message).toBe("");
    expect(after.attachments).toEqual([]);
    expect(after.busy).toBe(false);
    expect(after.sendError).toBe("");
  });
});
