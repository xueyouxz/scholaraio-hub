import type {
  UploadCancelMessage,
  UploadClientMessage,
  UploadEndMessage,
  UploadServerMessage,
  UploadStartMessage,
  UploadedFile,
} from "@scholaraio-hub/shared";

export interface UploadOptions {
  onProgress?: (uploaded: number, total: number) => void;
  signal?: AbortSignal;
}

export async function uploadFile(
  projectId: string,
  sessionId: string,
  file: File,
  options: UploadOptions = {},
): Promise<UploadedFile> {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = `${protocol}//${window.location.host}/api/projects/${projectId}/sessions/${sessionId}/upload/ws`;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;

    const cleanup = () => {
      options.signal?.removeEventListener("abort", handleAbort);
    };

    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        ws.close();
      } catch {
        // ignore
      }
      reject(error);
    };

    const succeed = (uploaded: UploadedFile) => {
      if (settled) return;
      settled = true;
      cleanup();
      ws.close(1000, "complete");
      resolve(uploaded);
    };

    const handleAbort = () => {
      const cancelMsg: UploadCancelMessage = { type: "cancel" };
      try {
        ws.send(JSON.stringify(cancelMsg satisfies UploadClientMessage));
      } catch {
        // ignore
      }
      fail(new Error("Upload aborted"));
    };

    if (options.signal?.aborted) {
      fail(new Error("Upload aborted"));
      return;
    }

    options.signal?.addEventListener("abort", handleAbort);

    ws.addEventListener("open", async () => {
      try {
        const startMsg: UploadStartMessage = {
          type: "start",
          name: file.name,
          size: file.size,
          mimeType: file.type || "application/octet-stream",
        };
        ws.send(JSON.stringify(startMsg satisfies UploadClientMessage));

        const chunkSize = 64 * 1024;
        let offset = 0;
        while (offset < file.size) {
          const slice = file.slice(offset, offset + chunkSize);
          const buffer = await slice.arrayBuffer();
          ws.send(buffer);
          offset += slice.size;
          options.onProgress?.(offset, file.size);
        }

        const endMsg: UploadEndMessage = { type: "end" };
        ws.send(JSON.stringify(endMsg satisfies UploadClientMessage));
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Upload failed"));
      }
    });

    ws.addEventListener("message", (event) => {
      try {
        const payload = JSON.parse(String(event.data)) as UploadServerMessage;
        if (payload.type === "complete") {
          succeed(payload.file);
          return;
        }
        if (payload.type === "progress") {
          options.onProgress?.(payload.bytesReceived, file.size);
          return;
        }
        if (payload.type === "error") {
          fail(new Error(payload.message));
        }
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Invalid upload response"));
      }
    });

    ws.addEventListener("error", () => fail(new Error("Upload connection failed")));
    ws.addEventListener("close", (event) => {
      if (!settled && event.code !== 1000) {
        fail(new Error(event.reason || "Upload connection closed"));
      }
    });
  });
}
