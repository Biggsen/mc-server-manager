# Copy Plugin List From Project

**Status:** Planned  
**Priority:** Medium  
**Estimate:** 1–2 days (Low–Medium complexity)  
**Dependencies:** None

## Overview

Allow users to copy the full plugin list (and their config mappings) from an existing project into another project. This supports the workflow: “I’ve built a server with lots of plugins; I want to create another project with the same plugin set” without re-adding each plugin by hand.

## Context

- Each project has `StoredProject.plugins: ProjectPlugin[]` (id, version, provider, source, cachePath, configMappings, etc.).
- Plugins are added one-by-one via `POST /projects/:id/plugins`; the backend ensures the plugin is in the library/cache, then calls `upsertProjectPlugin`.
- There is no bulk or “copy from project” flow today.

## Goal

- **Backend:** New endpoint that copies all plugins from a source project into a target project in one request, preserving versions, provider/source/cachePath, and **configMappings** (including custom config paths).
- **Frontend:** UI on the target project to choose a source project and run the copy (e.g. “Copy plugins from…” with a project selector and confirmation).

## Scope

### In scope

- Backend: `POST /projects/:targetId/plugins/copy-from/:sourceProjectId`
- For each plugin on the source project: ensure it exists in the plugin library/cache (reuse existing add-plugin resolution logic), then add/update the plugin on the target project with the same `ProjectPlugin` shape (including `configMappings`).
- Frontend: entry point on the target project’s plugin section (e.g. Project Detail → Plugins), project selector, confirmation, single API call, then refresh project data.
- Behavior when target already has some plugins: **replace** target’s plugin list with the source’s list (full overwrite), or **merge** (add source plugins; if target already has that plugin id, **skip** and report so the UI can notify). Default is **replace** for predictability.

### Out of scope

- Copying project configs (server.properties, paper-global, etc.); only plugin list + plugin config mappings.
- Copying overlays, profiles, or world setup.
- Selective copy (e.g. “copy only these 5 plugins”); future enhancement if needed.

## API

### `POST /projects/:targetId/plugins/copy-from/:sourceProjectId`

**Auth:** Same as other project routes (session/auth middleware).

**Parameters:**

- `targetId` — project that will receive the plugin list.
- `sourceProjectId` — project to copy the plugin list from.

**Query (optional):**

- `mode`: `replace` (default) | `merge`
  - `replace`: set target’s `plugins` to the source’s list (after resolving each plugin in library/cache). Preserve source project’s plugin order.
  - `merge`: add each source plugin to target in source order; if target already has that plugin id, **skip** it (do not update). Response includes which plugins were skipped so the UI can notify (e.g. “2 already present and skipped”).

**Success response:** `200 OK`

Return the updated target project. Either return full project (same shape as get project) or minimal `{ project: { id, plugins } }`; if the frontend refetches the project after copy, minimal is sufficient.

```json
{
  "project": {
    "id": "<targetId>",
    "plugins": [ /* full target project plugins array, in source order (replace) or merge order (merge) */ ]
  },
  "skippedPluginIds": [ "plugin-id-1", "..." ]
}
```

- `skippedPluginIds`: only present when `mode=merge`; list of plugin ids that were skipped because the target already had them. Frontend uses this to e.g. show “Copied N plugins; M already present and skipped.”

**Errors:**

- `404` — source or target project not found.
- `400` — invalid request (e.g. targetId === sourceProjectId if we disallow self-copy).
- `500` — resolution or persistence failure (e.g. plugin resolution failed for one of the source plugins).

**Behavior:**

1. Load source and target projects; return 404 if either missing.
2. Optionally return 400 if `sourceProjectId === targetId`.
3. If source has no plugins, treat as success: set target’s plugins to `[]` (replace) or leave unchanged (merge).
4. For each `ProjectPlugin` on the source project:
   - Ensure the plugin is in the plugin library and cache (same logic as `POST /projects/:id/plugins`: resolve, download if needed, `upsertStoredPlugin`). If resolution fails, abort the whole operation and return 500 (or 400 with a clear message).
   - No need to call the full “add plugin” route; instead call `upsertProjectPlugin(targetId, projectPlugin)` (or equivalent) with the **source** plugin payload so that `configMappings` (and any custom paths) are preserved. Use the resolved/cached plugin data only where needed (e.g. provider, cachePath) so the target gets the same versions and paths.
5. Preserve the source project’s plugin order: in **replace** mode, target’s list order = source’s order; in **merge** mode, newly copied plugins appear in source order (existing target-only plugins keep their positions; new ones are appended in source order).
6. For **replace** mode: after processing all source plugins, target’s plugin list is exactly the source list (with any backend-derived fields filled from resolution). For **merge** mode: add only plugins not already on target (skip duplicates); do not remove existing target-only plugins. When merging, record `skippedPluginIds` for any source plugin that was skipped because target already had that id.
7. Run the same post-add reconciliation as the add-plugin route (e.g. `reconcilePluginConfigMetadata`) per added plugin—see the handler for `POST /projects/:id/plugins` in `backend/src/routes/plugins.ts`.
8. Return the updated target project (and `skippedPluginIds` when `mode=merge`).

## Data and reuse

- Reuse existing helpers: `findProject`, `upsertStoredPlugin`, `upsertProjectPlugin`, plugin resolution/fetch (e.g. from `pluginRegistry` / build flow or the same logic used in the add-plugin route). Do not duplicate download/resolution logic; extract and call shared code.
- Preserve `ProjectPlugin` shape from source: `id`, `version`, `provider`, `source`, `minecraftVersionMin`, `minecraftVersionMax`, `cachePath`, `configMappings`. After resolution, merge in any backend-derived fields (e.g. resolved `cachePath`, `provider`) so the target project has a consistent record.

## Frontend

- **Place:** Project Detail page, Plugins section (or Plugins tab). A primary action such as “Copy from project…” or “Copy plugin list…” next to “Add plugin” (or in a menu).
- **Flow:**
  1. User clicks “Copy from project…”.
  2. Modal or dropdown lists other projects (exclude current project). Optionally show plugin count per project to help choose.
  3. User selects source project and optionally mode (Replace / Merge) if we expose it.
  4. Confirmation: e.g. “This will replace the plugin list of &lt;target&gt; with the &lt;N&gt; plugins from &lt;source&gt;. Continue?”
  5. Call `POST /projects/:targetId/plugins/copy-from/:sourceProjectId` (and optional `?mode=merge`).
  6. On success: refresh project data, close modal, show a short success toast (e.g. “Plugins copied from &lt;source&gt;.”). When `mode=merge` and response includes `skippedPluginIds`, mention skipped count if non-zero (e.g. “Copied 8 plugins; 2 already present and skipped.”). On error: show error message, keep modal open.
- **API client:** Add `copyProjectPluginsFrom(targetId: string, sourceProjectId: string, options?: { mode?: 'replace' | 'merge' })` in `frontend/src/lib/api.ts` that calls the new endpoint and returns the updated project plugins (or full project slice as needed).

## Edge cases

- **Source has no plugins:** Succeed; target’s list becomes empty (replace) or unchanged (merge).
- **Target and source are the same:** Return 400 with a clear message, or allow and treat as no-op; spec recommends 400 to avoid confusion.
- **Source has a plugin that fails resolution:** Abort entire copy, return 500 (or 400) with message indicating which plugin failed. Do not partially update the target.
- **Custom / uploaded plugins:** Source plugins that came from uploads have `provider: "custom"` and `cachePath`; resolution should recognize cached artifacts so no re-upload is required. If cache is missing, treat as resolution failure.

## Testing

- Unit or integration: copy from project A to B (replace); verify B’s plugins match A’s (ids, versions, configMappings).
- Copy from project with no plugins → target ends with no plugins (replace).
- Copy with merge: target already has plugin X, source has X and Y → target ends with X (unchanged, skipped) and Y; response includes `skippedPluginIds: [X]`.
- Error: source project not found → 404.
- Error: source has plugin that fails resolution → 500/400 and target unchanged.

## Success criteria

- User can copy the full plugin list (and config mappings) from one project to another in one action.
- No duplicate backend resolution logic; reuse existing plugin add/resolution flow.
- UI is discoverable from the target project’s plugin section and requires only selecting the source project and confirming.
