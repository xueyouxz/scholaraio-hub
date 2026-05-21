# Library Feature Architecture Refactor

**Status:** Complete  
**Date:** 2026-05-21  
**Scope:** `packages/client/src/features/library/` + `scholaraio/services/` + `scholaraio/serve.py`

---

## Background

A code audit of the Library feature identified 10 issues across the frontend and backend, traceable to three root causes:

| Root Cause | Description |
|------------|-------------|
| **A — Happy-path momentum** | Resources (timers, connections) acquired without a documented release path; guard clauses written as logs without early returns |
| **B — Paradigm mismatch** | D3/canvas imperative state managed inside React's reactive system, causing cascade invalidation on resize |
| **C — Scattered ownership** | Shared derived data recomputed independently in each consumer; job submission spread across multiple uncoordinated entry points |

This document describes the target architecture and the phased execution plan to reach it.

---

## Problem Inventory

### Critical

| # | Location | Issue |
|---|----------|-------|
| C1 | `LibraryAnalyticsPanel.tsx:36` | `setInterval` created in `useMutation.onSuccess` closure with no cleanup — leaks on component unmount |
| C2 | `projection.py:68` | File-existence check emits a log but does not `return` — UMAP runs on every job submit regardless of `rebuild` flag |

### Major

| # | Location | Issue |
|---|----------|-------|
| M1 | `serve.py:553` | Opens a new SQLite connection on every `GET /analytics/projection` request to compute the `stale` flag |
| M2 | `serve.py:548` | Corrupted `projection.json` returns `{ built: false }` instead of an error, silently hiding data loss |
| M3 | `jobs.py:128` | `JobRunner.submit` has no deduplication — submitting `project` twice queues two full UMAP runs |
| M4 | `TopicBubbleBar.tsx:48` | `buildTopicColors` called on every render without `useMemo`, rebuilds a `Map` for 40+ topics each time |
| M5 | `ScatterPlot.tsx:34–135` | `xScale`/`yScale` inside `useMemo` with `[points, width, height]` deps — every resize cascades to quadtree rebuild + draw callback rebind + canvas repaint |
| M6 | `LibraryAnalyticsPanel.tsx:81,128` | Two job submission buttons have no `isPending` guard and can submit duplicate jobs |

### Minor

| # | Location | Issue |
|---|----------|-------|
| m1 | `projection.py:_load_data` | Per-paper serial `meta.json` reads in a loop instead of batch DB query |
| m2 | `projection.py:186` | `pickle.load` errors silently fall through, losing all topic assignments with no warning |

---

## Target Architecture

### Backend

```
Write path (job completion):
  embed job done  ──► write manifest.json { vectorCount, updatedAt }
  project job done ──► write projection.json (atomic rename, includes vectorCount snapshot)
  topics job done  ──► write topics/overview.json

Read path (GET requests):
  GET /analytics/projection
    ├─ read projection.json          (file I/O only)
    ├─ read manifest.json            (file I/O only)
    └─ stale = projection.vectorCount ≠ manifest.vectorCount
       (zero DB queries per request)

Job submission:
  POST /jobs { kind: "project" }
    ├─ JobRunner checks: is there already a queued/running "project" job?
    ├─ YES → return existing job (idempotent)
    └─ NO  → enqueue new job

Job status (push, not poll):
  GET /api/v1/jobs/stream   (text/event-stream, SSE)
    └─ emits: { jobId, kind, status } on every job state transition
```

### Frontend

```
LibraryAnalyticsPanel
  ├─ computes topicColors (useMemo, once)          ← single source of truth
  ├─ useJobMutation("project")                     ← unified submit + SSE-backed pending state
  ├─ useJobMutation("topics")                      ← same pattern
  ├─ TopicBubbleBar  (receives topicColors prop)
  └─ ScatterPlot     (receives topicColors prop)
       └─ ScatterPlotController (imperative class)
            ├─ owns: canvas, xScale, yScale, zoom, quadtree, ResizeObserver
            ├─ React calls: controller.update(data) when props change
            └─ React calls: controller.destroy() on unmount

useJobMutation(kind):
  ├─ submits via POST /jobs
  ├─ subscribes to SSE /jobs/stream
  ├─ on kind-matched succeeded/failed → invalidateQueries
  ├─ EventSource closed on hook unmount  (no timer leaks possible)
  └─ returns { submit, isPending }
```

---

## Affected Files

| File | Change | Notes |
|------|--------|-------|
| `scholaraio/services/projection.py` | Modify | Early return + atomic write |
| `scholaraio/services/jobs.py` | Modify | Singleton dedup + SSE notification queue |
| `scholaraio/serve.py` | Modify | Staleness via manifest, SSE endpoint, fix error handling |
| `packages/client/src/core/api.ts` | Modify | Add `getJobStream` SSE helper |
| `packages/client/src/features/library/types.ts` | Modify | Add `TopicColorMap` type |
| `packages/client/src/features/library/hooks/useJobMutation.ts` | **New** | Unified job hook |
| `packages/client/src/features/library/components/charts/ScatterPlotController.ts` | **New** | Imperative D3 controller class |
| `packages/client/src/features/library/components/charts/ScatterPlot.tsx` | Rewrite | Thin React wrapper |
| `packages/client/src/features/library/components/TopicBubbleBar.tsx` | Modify | Accept `topicColors` prop |
| `packages/client/src/features/library/components/LibraryAnalyticsPanel.tsx` | Modify | Compute `topicColors`, use `useJobMutation`, remove polling |
| `packages/client/src/features/library/components/TopicSidebar.tsx` | **Delete** | No longer referenced |

---

## Execution Plan

Each phase is independently deployable and independently rollbackable.

---

### Phase 1 — Backend Correctness (no interface changes)

Fix the two Critical bugs. Zero risk of breaking existing clients.

- [ ] **1.1** `projection.py:68-69` — After the emit, add `return json.loads(out_path.read_text(encoding="utf-8"))` so `rebuild=False` is actually honored
- [ ] **1.2** `projection.py:114-116` — Replace direct `json.dump` to final path with write-to-temp + `os.replace` (atomic rename) to prevent partial writes
- [ ] **1.3** `serve.py:545-549` — Split the `except Exception` into two branches: `FileNotFoundError` → `{ built: false }`, all other exceptions → HTTP 500 with the exception message
- [ ] **Verify:** `pnpm test`; POST `{ kind: "project" }` twice in quick succession, confirm second call returns immediately without re-running UMAP

---

### Phase 2 — Backend Architecture: Staleness + Job Singleton

Eliminate per-request DB access; prevent duplicate job execution.

- [ ] **2.1** `jobs.py` — On `embed` job success, write `data/state/manifest.json`:
  ```json
  { "vectorCount": 1044, "updatedAt": "2026-05-21T00:00:00Z" }
  ```
  Locate all paths where an embed job completes (grep `_run_embed_job` and pipeline steps that include embed) and add the write to each.

- [ ] **2.2** `serve.py GET /analytics/projection` — Replace the SQLite block (lines 553–558) with:
  ```python
  manifest_count = 0
  try:
      manifest = json.loads(resolved_cfg.manifest_path.read_text(encoding="utf-8"))
      manifest_count = manifest.get("vectorCount", 0)
  except FileNotFoundError:
      pass
  stale = data.get("vectorCount", 0) != manifest_count
  ```
  Add `manifest_path` to `Config` pointing to `data/state/manifest.json`.

- [ ] **2.3** `jobs.py JobRunner.submit` — Add singleton check before enqueue:
  ```python
  def _find_active_locked(self, kind: str) -> "Job | None":
      for job in reversed(list(self._jobs.values())):
          if job.kind == kind and job.status in {"queued", "running"}:
              return job
      return None
  ```
  In `submit()`, after `kind = _normalize_kind(kind)`, call `_find_active_locked` for singleton kinds (`{"topics", "project"}`); if found, return that job's dict instead of creating a new one.

- [ ] **Verify:** Confirm `GET /analytics/projection` logs show no `sqlite3` calls; POST two `project` jobs back-to-back returns the same `jobId` for both

---

### Phase 3 — Backend: SSE Job Status Stream

Replace client polling with a push stream. Prerequisite for Phase 6.

- [ ] **3.1** `jobs.py` — Add subscriber registry to `JobRunner`:
  ```python
  self._subscribers: list[queue.SimpleQueue] = []

  def subscribe(self) -> queue.SimpleQueue:
      q: queue.SimpleQueue = queue.SimpleQueue()
      with self._lock:
          self._subscribers.append(q)
      return q

  def unsubscribe(self, q: queue.SimpleQueue) -> None:
      with self._lock:
          self._subscribers = [s for s in self._subscribers if s is not q]
  ```
  In `_run()`, at each status transition (queued→running, running→succeeded/failed/cancelled), push `{ "jobId": ..., "kind": ..., "status": ... }` to all subscribers.

- [ ] **3.2** `serve.py` — Add `GET /api/v1/jobs/stream`:
  ```python
  @app.get("/api/v1/jobs/stream")
  def stream_jobs():
      import queue as _queue
      q = job_runner.subscribe()

      def generate():
          try:
              while True:
                  try:
                      event = q.get(timeout=30)
                      yield f"data: {json.dumps(event)}\n\n"
                  except _queue.Empty:
                      yield ": keepalive\n\n"
          finally:
              job_runner.unsubscribe(q)

      return StreamingResponse(generate(), media_type="text/event-stream",
                               headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})
  ```

- [ ] **Verify:** `curl -N http://localhost:PORT/api/scholar/api/v1/jobs/stream`; POST a `project` job; observe `queued`, `running`, `succeeded` events in the stream; confirm connection closes cleanly after `Ctrl-C`

---

### Phase 4 — Frontend: Types + Shared topicColors

Prerequisite for Phases 5 and 6. Zero visual change.

- [ ] **4.1** `types.ts` — Add:
  ```ts
  export type TopicColorMap = Map<number, string>;
  ```

- [ ] **4.2** `TopicBubbleBar.tsx` — Add `topicColors: TopicColorMap` to `Props`; delete the `buildTopicColors(topics.map(...))` call; use the prop directly

- [ ] **4.3** `ScatterPlot.tsx` — Add `topicColors: TopicColorMap` to `Props`; delete `useMemo(() => buildTopicColors(...), [points])`

- [ ] **4.4** `LibraryAnalyticsPanel.tsx` — Add:
  ```tsx
  const topicColors = useMemo(
    () => buildTopicColors(topics.map((t) => t.id)),
    [topics],
  );
  ```
  Pass `topicColors` to both `<TopicBubbleBar>` and `<ScatterPlot>`.

- [ ] **Verify:** `pnpm typecheck`; colors are consistent between bubble bar and scatter plot; no visible change in behavior

---

### Phase 5 — Frontend: ScatterPlot Controller

Decouple D3 from React's render cycle. Eliminates the resize cascade.

- [ ] **5.1** New file `components/charts/ScatterPlotController.ts`:

  **Public interface:**
  ```ts
  interface ScatterPlotData {
    points: ScholarProjectionPoint[];
    activeIds: Set<string> | null;
    selectedId: string | null;
    topicColors: TopicColorMap;
  }

  class ScatterPlotController {
    constructor(container: HTMLElement, onPointClick: (id: string) => void)
    update(data: ScatterPlotData): void   // called when React props change
    destroy(): void                        // called on unmount
  }
  ```

  **Internal ownership** (not exposed to React):
  - `canvas` element (appended to container)
  - `xScale`, `yScale` — rebuilt only when `points` changes (domain change) or container resizes (range change only)
  - `quadtree` — rebuilt only when `points` changes
  - `zoom` behavior — attached once, never re-attached
  - `transformRef` — preserved across `update()` calls; only reset if `points` identity changes
  - `ResizeObserver` — calls `resize(w, h)` internally, updates scale ranges and redraws; does not trigger React state

  **Key invariant:** `update()` never resets the zoom transform unless `points` array reference changes. `resize()` never rebuilds the quadtree.

- [ ] **5.2** Rewrite `ScatterPlot.tsx` to a thin wrapper:
  ```tsx
  export function ScatterPlot({ points, activeIds, selectedId, topicColors, onPointClick }: Props) {
    const containerRef = useRef<HTMLDivElement>(null);
    const controllerRef = useRef<ScatterPlotController | null>(null);

    useEffect(() => {
      if (!containerRef.current) return;
      controllerRef.current = new ScatterPlotController(containerRef.current, onPointClick);
      return () => { controllerRef.current?.destroy(); controllerRef.current = null; };
    }, [onPointClick]);

    useEffect(() => {
      controllerRef.current?.update({ points, activeIds, selectedId, topicColors });
    }, [points, activeIds, selectedId, topicColors]);

    return <div ref={containerRef} className="w-full h-full" />;
  }
  ```
  Delete all `useMemo`, `useCallback`, `useRef` for canvas/scales/quadtree/tooltip from the component.

- [ ] **Verify:** Drag-resize window — no jank; zoom/pan preserved after resize; click and hover interactions correct; `activeIds` filter visually correct

---

### Phase 6 — Frontend: Unified Job Submission + SSE

Replace polling with push; remove all unguarded submission buttons.

- [ ] **6.1** New file `hooks/useJobMutation.ts`:
  ```ts
  export function useJobMutation(kind: "topics" | "project") {
    const queryClient = useQueryClient();
    const [isPending, setIsPending] = useState(false);

    useEffect(() => {
      const es = new EventSource(`${SCHOLAR_API_BASE}/jobs/stream`);
      es.onmessage = (e) => {
        const event = JSON.parse(e.data) as { kind: string; status: string };
        if (event.kind !== kind) return;
        if (event.status === "running") setIsPending(true);
        if (["succeeded", "failed", "cancelled"].includes(event.status)) {
          setIsPending(false);
          const key = kind === "project"
            ? queryKeys.scholar.projection()
            : queryKeys.scholar.topics();
          queryClient.invalidateQueries({ queryKey: key });
        }
      };
      es.onerror = () => setIsPending(false);
      return () => es.close();
    }, [kind, queryClient]);

    const submit = useCallback(() => {
      if (isPending) return;
      setIsPending(true);
      scholar.submitJob({ kind }).catch(() => setIsPending(false));
    }, [kind, isPending]);

    return { submit, isPending };
  }
  ```

- [ ] **6.2** `LibraryAnalyticsPanel.tsx` — Remove `rebuildMutation`, `handleTopicBuild`, and the `setInterval` polling block. Replace with:
  ```tsx
  const projectJob = useJobMutation("project");
  const topicsJob = useJobMutation("topics");
  ```
  Update all three submission sites:
  - Stale banner button → `onClick={projectJob.submit}` + `disabled={projectJob.isPending}`
  - TopicBubbleBar `onBuildRequest` → `topicsJob.submit`
  - Scatter plot empty-state button → `onClick={projectJob.submit}` + `disabled={projectJob.isPending}`

- [ ] **6.3** `api.ts` — Add:
  ```ts
  getJobStream: () => new EventSource(`${SCHOLAR_API_BASE}/jobs/stream`)
  ```

- [ ] **Verify:** Open DevTools Network tab; navigate to Library page; confirm one `jobs/stream` SSE connection opens; submit a job; confirm no `setInterval` polling visible; navigate away; confirm SSE connection closes

---

### Phase 7 — Cleanup

- [ ] Delete `components/TopicSidebar.tsx` (no remaining imports)
- [ ] Remove unused imports from `LibraryAnalyticsPanel.tsx` (`buildYearCounts` moved earlier, old mutation types)
- [ ] `pnpm lint:fix`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`

---

## Rollback Plan

| Phase | Rollback action |
|-------|----------------|
| 1 | `git revert` — no interface change, clients unaffected |
| 2 | Revert `serve.py` staleness block; delete `manifest.json`; revert `jobs.py` singleton check |
| 3 | Remove SSE endpoint from `serve.py`; remove subscriber registry from `jobs.py` |
| 4 | Restore `buildTopicColors` calls inside `TopicBubbleBar` and `ScatterPlot`; remove `topicColors` prop |
| 5 | Restore original `ScatterPlot.tsx`; delete `ScatterPlotController.ts` |
| 6 | Restore `rebuildMutation` and `handleTopicBuild`; delete `useJobMutation.ts` |

---

## Risks

| Risk | Likelihood | Mitigation |
|------|-----------|-----------|
| `embed` job has multiple completion paths — manifest not written on all of them | Medium | Before Phase 2.1, grep all `_run_embed_job` calls and pipeline steps that include embed; write manifest in a shared `_on_embed_complete()` helper |
| SSE stream blocked by reverse proxy buffering | Low | Add `X-Accel-Buffering: no` header (Phase 3.2); document in deployment notes |
| `ScatterPlotController` zoom transform reset after `update()` when `points` reference is stable | Medium | In `update()`, only reset transform when `this.points !== data.points` (identity check, not deep equal) |
| `EventSource` reconnects on network drop and may miss a `succeeded` event | Low | On reconnect, `useJobMutation` should call `GET /api/v1/jobs?limit=5` to sync current state; or rely on React Query's `staleTime` expiry which will refetch on next focus |
