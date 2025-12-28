# Manage Plugin Config Paths — Design

**Status:** ✅ Implemented

## Implementation Status

All features described in this spec have been implemented. The implementation follows the design with one UX variation:

- **Plugin Library**: Fully implemented as specified — "Manage config paths" button opens a modal with full CRUD for config definitions.
- **Project Detail — Plugins Tab**: Implemented with an accordion-based UI within plugin cards instead of a dedicated side panel. The accordion shows:
  - Library definitions with status badges (Missing/Uploaded/Generated)
  - Custom path definitions with edit/remove actions
  - "Add custom config" functionality
  - All functionality from the spec is available, just presented in a more compact accordion format
- **Config Files Tab**: Fully implemented — plugin selector, definition selector with path pre-filling, and config grouping by plugin.
- **Backend**: All API endpoints, data models, validation, scanner integration, and config upload matching are fully implemented.

## Context

Uploading plugin configuration files currently depends on ad-hoc relative paths.
Projects can add any config file path they like, but the app cannot:

- Tell which configs belong to which plugin
- Detect missing required configs
- Offer a guided flow when uploading configs

The goal is to let users define canonical config paths for each plugin in the
Plugin Library and manage those mappings per project. The UI should surface
missing configs and streamline uploads by suggesting the expected filenames.

## Scope

- Extend stored plugin metadata with config path definitions, including labels
  and requirement semantics
- Allow project-specific overrides of those definitions (custom paths,
  optionality overrides, notes)
- Surface combined definition + status in project detail views (“Manage config
  paths” action)
- Keep manifests and build system using absolute paths only (no schema change)

Out of scope for this iteration:

- Parsing plugin jars to infer configs
- Automatic template generation
- Version-specific definition variants

## Data Model Changes

### Plugin Library Records

`StoredPluginRecord` gains an optional `configDefinitions` array:

```ts
type PluginConfigRequirement = "required" | "optional" | "generated";

interface PluginConfigDefinition {
  id: string;                // stable slug within the plugin scope
  path: string;              // relative to project root (e.g. plugins/WorldGuard/config.yml)
  label?: string;            // friendly name shown in UI
  requirement?: PluginConfigRequirement;
  description?: string;
  tags?: string[];           // e.g. ["worlds", "advanced"]
}
```

Notes:

- Existing library entries simply omit `configDefinitions`; the field defaults
  to `[]`.
- For storage (`data/plugins.json`), simply persist the new field.
- Provide a helper to assign generated IDs (e.g. kebab-cased label or
  `cfg-<hash>`), keeping them stable so project bindings survive edits.

### Project Plugins & Configs

`ProjectPlugin` gains optional `configMappings`:

```ts
interface ProjectPluginConfigMapping {
  definitionId: string;            // references PluginConfigDefinition.id
  path?: string;                   // override path for this project
  requirement?: PluginConfigRequirement;
  notes?: string;
}
```

This allows project-level adjustments without mutating the shared definition.

`StoredProject["configs"]` remains the manifest list. To connect uploads to
definitions we add an optional `pluginId` + `definitionId`:

```ts
type StoredProjectConfigEntry = {
  path: string;
  sha256?: string;
  pluginId?: string;
  definitionId?: string;
};
```

Backward compatibility is automatic because the extra keys are optional.

## API Changes

### Plugin Library

- `GET /plugins/library` now returns `configDefinitions`.
- `POST /plugins/library` & `/plugins/library/upload` accept an optional
  `configDefinitions` payload.
- New endpoint `PUT /plugins/library/:id/:version/configs` to replace the
  definitions for a stored plugin (used by the new “Manage config paths” UI in
  the library).

Wire validation:

- Require unique `definitionId`s per plugin
- Ensure paths are normalized (posix, no traversal, no leading slashes)

### Project-level Config Mapping

Add a lightweight facade to merge shared definitions with project overrides &
upload status:

- `GET /projects/:id/plugins/:pluginId/configs`
  - returns:
    - `definitions`: full list with requirement, resolved path (library path
      overridden by project mapping), requirement override, notes
    - `status`: uploaded config summary (size, sha256, modifiedAt)
    - `missing`: boolean
- `PUT /projects/:id/plugins/:pluginId/configs`
  - accepts array of `ProjectPluginConfigMapping` to update overrides
  - persists to `ProjectPlugin.configMappings`
  - recalculates `StoredProject.configs` entries (adds `pluginId` /
    `definitionId` when an upload matches)

Existing `/projects/:id/configs` endpoints continue to work. When returning
config summaries we include the new metadata if present.

### Scanning & Manifest

- `scanProjectAssets` associates discovered config files with definitions when
  possible (match by relative path). It records `pluginId` + `definitionId`
  when found.
- `renderManifest` still outputs `{ path, sha256 }`; `pluginId` metadata is
  ignored by the manifest template.

## Backend Implementation Steps

1. **Types & storage**
   - Update `StoredPluginRecord`, `ProjectPlugin`, and `StoredProject` types.
   - Adjust serialization in `pluginsStore`, `projectsStore`, and derived
     helpers to read/write the new fields.

2. **Validation helpers**
   - Reuse `sanitizeRelativePath` from `configUploads` for definitions.
   - Add a shared util for slug generation and normalization.

3. **API routes**
   - Update `/plugins/library` handlers to accept & persist definitions.
   - Add new `PUT` route for updating config definitions.
   - Add `GET`/`PUT` project plugin config routes (likely colocated with
     existing `/projects/:id/plugins` routes).

4. **Config uploads integration**
   - When saving an uploaded config, attempt to match to a definition by path
     (using project mapping). Persist `pluginId` / `definitionId` on the stored
     config entry for quick lookups.

5. **Scanner updates**
   - During project scans, match discovered configs to definitions.
   - Populate `configMappings` defaults for plugins lacking explicit overrides.

6. **Tests & migrations**
   - Update existing tests (build queue, scanner, config uploads) to assert the
     new metadata.
   - For existing data files, rely on optional fields; no migration script needed
     but document that editing a plugin in the library adds the new field.

## UI Interaction Model (Overview)

Frontend updates are covered separately, but key flows driving the backend
contract:

- Plugin Library → “Manage config paths” modal: CRUD definitions, mark required,
  reorder (client-side only, but maintain ID order when persisting).
- Project Detail → “Manage config paths” action per plugin: displays combined
  definition + status list, allows overriding path/requirement for that project,
  and links to upload when missing.
- Config tab grouping uses the same merged data.

## Frontend UX Plan

### Plugin Library

- **Entry point**: add “Manage config paths” action in the table row actions
  (next to Delete). Opens a modal/drawer.
- **Modal layout**:
  - Header with plugin id/version + link back to project usage.
  - List of existing definitions rendered as cards:
    - Editable fields: label, relative path, requirement (chips), description.
    - Drag handle to reorder (optional; order stored client-side and persisted).
    - Trash icon to remove. Confirm if mapping is in use by any project (requires
      API to return usage count per definition).
  - “Add config path” button → appends a blank card with generated ID based on
    label or path.
- **Validation**: inline errors for empty path, duplicate path/ID, invalid
  characters (reuse `sanitizeRelativePath` logic on blur).
- **Save flow**: `PUT /plugins/library/:id/:version/configs`. Show optimistic save
  spinner and toast on success/failure.

### Project Detail – Plugins tab

- In each plugin card, add a secondary button “Manage config paths”.
- Clicking opens a side panel (reuse existing panel pattern):
  - **Summary**: list definitions with status chips:
    - `Missing` / `Uploaded` / `Generated` (based on backend status response).
    - Show resolved path (library path overridden by project mapping if present).
    - Show `Upload` button for missing required configs; clicking focuses the
      upload form with prefilled path.
  - **Override controls**: for each definition, allow:
    - Override path (text input; defaults to library path).
    - Override requirement (dropdown: required/optional/generated).
    - Notes textarea (optional).
  - **Custom configs**: allow adding ad-hoc entries that map to `configMappings`
    without touching the library definition (creates `definitionId` with `custom/<uuid>`).
  - **Save**: `PUT /projects/:id/plugins/:pluginId/configs`.
  - Inline preview of existing uploaded file (size, modified timestamp) with
    links to edit/download.
- Update the Config Files tab to display grouped by plugin:
  - Section per plugin with badges showing missing count.
  - “Add config” form gains plugin selector; when a definition is chosen, path
    field pre-fills and locks unless the user toggles “custom path”.
  - For configs not tied to a definition, display under “Other configs”.

### Generate Profile Page

- When listing `additionalConfigs`, group by plugin definitions.
- Allow toggling include/exclude, showing whether the config has been uploaded.
- Warn when generating profile if required definitions are missing uploads or a
  path override is empty.

### Cross-cutting UX Considerations

- Toast messaging: differentiate between library-level vs project-level updates.
- Loading states: show skeletons/spinners inside modals while fetching
  definitions.
- Accessibility: ensure keyboard support for reordering and toggles.
- Analytics/logging: (optional) track config management actions for later
  iteration.

## Open Questions / Follow-ups

- Should definitions support multiple files per requirement (e.g., glob)? For
  now we assume single concrete paths.
- Do we need version-specific definitions? Out of scope now; the chosen data
  model can be extended later by nesting under version ranges.
- Should user-defined configs without library definitions be tagged? We can
  auto-create ephemeral definitions (`definitionId = "__custom__/<path>"`) if
  needed, but not essential for phase one.


