import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Replace `file` with `content` in one step: readers see the old file or the
 * new one, never half of either, even when the process dies mid-write.
 */
export async function writeFileAtomic(file: string, content: string, mode = 0o600): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, content, { mode });
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
