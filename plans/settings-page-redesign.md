# Plan: Settings Page Redesign

> Source: grill-me session 2026-05-21 — settings layout, config editing, health check system

## Architectural decisions

- **Scholar proxy**: Hub BFF (`/api/scholar/*`) is a transparent proxy to Python service. New Python endpoints (`PATCH /api/v1/config`, `POST /api/v1/health/check`) are automatically proxied — no Hub proxy changes needed.
- **File browser**: NOT proxied through scholar path. Hub BFF owns `GET /hub/fs/browse?path=` independently (server-side filesystem from Hub's perspective).
- **Config write target**: Python service writes partial patches into `config.local.yaml` via deep merge; `config.yaml` is never touched.
- **Key masking**: Backend always returns masked keys. Frontend never holds real API key values after save.
- **Health check execution**: All check levels (format, connectivity, auth) run in Python service. Frontend triggers and polls results.
- **Inline edit save**: Field-level PATCH on blur/enter. Empty API key value = no-op (backend ignores empty strings for key fields).
- **Provider toggle**: Changing `embed.provider` is a standalone PATCH; both `local` and `api` sub-configs persist independently in config.local.yaml.

---

## Phase 1: Layout + Expanded Read-only Sections

**Delivers**: Correct layout with collapsible sections and richer field display. No editing yet.

### What to build

Restructure `SettingsPage.tsx` to use `max-w-3xl mx-auto` with `px-8` inner padding. Replace the current flat `ConfigRow` list with three collapsible section components:

- **LLM**: collapsed = model name only; expanded = `base_url` + `api_key` (read-only)
- **Embed**: collapsed = model name + `provider` badge (`local` / `api`); expanded = conditional fields based on provider (`source` + `cache_dir` for local; `api_base` + `api_key` for api)
- **Ingest**: primary tier always visible (`pdf_preferred_parser` selector + MinerU local sub-block + MinerU cloud sub-block + `s2_api_key`); advanced tier (lang, parse_method, abstract_llm_mode, formula/table toggles) behind a secondary expand

Expand `ScholarConfig` in `api.ts` to include all displayed fields:
```ts
embed: { provider: string; model: string; source: string; cache_dir: string; api_base: string; api_key: string }
ingest: {
  pdf_preferred_parser: string;
  mineru_endpoint: string; mineru_api_key: string;
  mineru_cloud_url: string;
  s2_api_key: string;
  mineru_lang: string; mineru_parse_method: string;
  abstract_llm_mode: string;
  mineru_enable_formula: boolean; mineru_enable_table: boolean;
}
```

Update Python `GET /api/v1/config` to return these additional fields.

### Acceptance criteria

- [ ] Settings page renders with `max-w-3xl` centred layout and visible side breathing room
- [ ] LLM section collapses/expands; collapsed state shows model name
- [ ] Embed section shows `provider` badge; expands to correct conditional fields for local vs api
- [ ] Ingest primary tier shows both MinerU sub-blocks (local & cloud) clearly separated with labels "Local (优先)" and "Cloud (备用)"
- [ ] Ingest advanced tier is hidden behind a secondary expand toggle
- [ ] All fields receive short Chinese descriptions beneath the label
- [ ] `ScholarConfig` type covers all displayed fields; TypeScript compiles without errors (`pnpm typecheck`)
- [ ] Python `GET /api/v1/config` returns `embed.cache_dir`, `embed.api_base`, `ingest.pdf_preferred_parser`, `ingest.mineru_cloud_url`, `ingest.mineru_lang`, `ingest.mineru_parse_method`, `ingest.abstract_llm_mode`, `ingest.mineru_enable_formula`, `ingest.mineru_enable_table`

---

## Phase 2: Python PATCH endpoint + Inline text/key field editing

**Delivers**: Users can edit and save text fields and API keys inline. Path fields show edit button but are not yet functional.

### What to build

**Python service** — add `PATCH /api/v1/config`:
- Accepts partial nested body: `{ "llm"?: {...}, "embed"?: {...}, "ingest"?: {...} }`
- Loads existing `config.local.yaml` (or empty dict if absent), deep-merges the patch, writes back
- Ignores empty string values for `*_api_key` and `*_api_token` fields (treat as "no change")
- Returns the full updated config snapshot (same shape as GET, with masked keys)
- Error cases: file not writable → 500 with diagnostic message; invalid field types → 422

**Hub BFF** — add `scholar.patchConfig` in `api.ts`:
```ts
patchConfig: (patch: DeepPartial<ScholarConfig>, options?: RequestOptions) =>
  requestJson<ScholarConfig>(`${SCHOLAR_API_BASE}/config`, {
    method: "PATCH",
    body: JSON.stringify(patch),
    signal: options?.signal,
  })
```

Add `queryKeys.scholar.configMutation` for invalidation.

**Frontend `SettingsPage`** — inline edit behaviour:
- Each editable field renders as `<span>` (read-only) by default; click → replace with `<input>` focused
- On blur or Enter: call `scholar.patchConfig` with the single changed field; optimistic update in react-query cache; show brief ✓ on success or ✗ + error tooltip on failure
- API Key fields: input is always empty on enter-edit; placeholder shows `已配置（…${maskedSuffix}）`; submitting empty value skips the PATCH call entirely
- Embed `provider` toggle: clicking the badge fires `patchConfig({ embed: { provider: newValue } })` immediately, then invalidates `scholar.config` query

### Acceptance criteria

- [ ] `PATCH /api/v1/config` with `{"llm":{"model":"gpt-4o"}}` updates `config.local.yaml` and is reflected on next `GET /api/v1/config`
- [ ] Empty string for `api_key` fields in PATCH body is silently ignored; existing key is preserved
- [ ] Python returns 500 with message (not silent) when `config.local.yaml` is not writable
- [ ] Clicking a text field in the UI enters edit mode; blur/Enter saves and shows ✓ confirmation
- [ ] API Key field enters edit with empty input; placeholder shows masked suffix; submitting empty does not call PATCH
- [ ] Toggling Embed provider badge fires PATCH and the section re-renders correct sub-fields
- [ ] `pnpm test` passes (add unit test for PATCH deep-merge logic in Python; add route test in `packages/server/test/routes/`)

---

## Phase 3: Python health/check endpoint + Health check UI

**Delivers**: Each section shows live connection/auth status with multi-level detail. Checks trigger on page load, after config save (debounced), and manually.

### What to build

**Python service** — add `POST /api/v1/health/check`:
- Accepts `{ "scope": "llm" | "embed.local" | "embed.api" | "ingest.mineru_local" | "ingest.mineru_cloud" | "ingest.s2" | "paths" }`
- Returns `{ scope, levels: [{ level: 1|2|3, label: string, status: "ok"|"fail"|"skip", detail?: string }] }`
- Runs levels serially; stops on first failure
- LLM L3: `GET {base_url}/models` with API key header — does NOT send a chat completion
- embed.local L2: check model file presence in `cache_dir` (does not load model)
- embed.local L3: skipped (status: "skip")
- All network calls have a 5s timeout; timeout → status "fail" with detail message

**Frontend** — `HealthCheckIndicator` component:
- Accepts `scope` prop; renders a status icon in the section header
- States: idle (grey dot) → checking (⟳ spinner) → ok (green ✓) → degraded (yellow ⚠, some levels failed) → error (red ✗)
- Clicking the icon or a「重新检查」button expands a detail panel showing each level's label + status + detail message
- Trigger logic (in a custom `useHealthCheck(scope)` hook):
  - On mount: fire check immediately
  - After a successful `patchConfig` for that scope: debounce 1.5s then fire
  - Manual: exposed `recheck()` function bound to button
  - Cleanup: cancel in-flight fetch on unmount

### Acceptance criteria

- [ ] `POST /api/v1/health/check` with `{"scope":"llm"}` returns all three level results
- [ ] LLM L3 calls `GET /models` endpoint, not a chat completion
- [ ] Network timeout after 5s returns `{"status":"fail","detail":"connection timed out"}`
- [ ] Health icons appear in LLM, Embed, and Ingest section headers
- [ ] Clicking icon expands level detail panel; each level shows label + status + detail
- [ ] After saving LLM `base_url`, the LLM health icon starts checking after 1.5s debounce
- [ ] Manual recheck button reruns the check
- [ ] `useHealthCheck` hook cleans up in-flight fetch on unmount (no memory leak; verified by React StrictMode double-mount)
- [ ] `pnpm typecheck` passes with typed `HealthCheckResult` shared between api.ts and component

---

## Phase 4: Hub BFF file browser + Path field editing

**Delivers**: Path fields (papers_dir, workspace_dir, cache_dir) open a directory-browse panel instead of a raw text input.

### What to build

**Hub BFF** — new route `GET /hub/fs/browse`:
- Query param `path` (default: `/`); resolves to absolute path on server filesystem
- Returns `{ path: string, entries: [{ name: string, isDir: boolean }] }`
- Security: restrict to non-hidden directories; reject paths containing `..` after resolution; only return directories (no files) to prevent filesystem enumeration
- Error: path not found → 404; path not a directory → 400; permission denied → 403

**Frontend** — `FileBrowserPanel` component:
- Modal/popover with breadcrumb navigation + scrollable directory list
- Clicking a directory navigates into it (new `GET /hub/fs/browse?path=` call)
-「选择当前目录」button confirms selection and closes panel
- Keyboard: arrow keys navigate list; Enter confirms; Escape closes
- Path fields in SettingsPage render an edit icon button; clicking opens the panel

**api.ts** — add `browseFsDirectory`:
```ts
browseFsDirectory: (path: string, options?: RequestOptions) =>
  requestJson<{ path: string; entries: { name: string; isDir: boolean }[] }>(
    withQuery("/hub/fs/browse", { path }),
    { signal: options?.signal },
  )
```

### Acceptance criteria

- [ ] `GET /hub/fs/browse?path=/tmp` returns correct directory listing
- [ ] Path traversal attempt (`?path=/etc/../root`) is rejected with 400
- [ ] Hidden directories (`.git`, `.env`) are not listed
- [ ] Clicking a path field's edit icon opens the browser panel
- [ ] Breadcrumb shows current path; clicking a crumb navigates up
- [ ] Selecting a directory and confirming fires `patchConfig` with the new path
- [ ] Escape key closes the panel without saving
- [ ] `pnpm test` passes with route unit tests for `GET /hub/fs/browse` covering security and 404 cases
