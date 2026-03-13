# Deployments Specification – MC Server Manager

## Overview

The Deployments feature produces **server deployment zips**—archives with a standard Minecraft server layout—and maintains a **history** of each deployment. This is separate from the existing **build** artifact: builds are project-centric (profile, registry, overlays, config, plugins); deployment zips are server-centric (config and plugins only), suitable for dropping onto a server or publishing to a target later.

**Scope for now:** Build proper server deployment zips and record a history of each. Publishing to deployment targets (folder/SFTP) remains a later phase.

---

## 1. Deployment zip vs build artifact

| Aspect | Build artifact (current) | Deployment zip (this spec) |
|--------|--------------------------|----------------------------|
| **Purpose** | Project snapshot for runs, versioning, GitHub push | Server-ready package for deploy/history |
| **Contents** | Profile, `plugins/registry.yml`, overlays, config, plugins | Server layout only (see §2) |
| **Structure** | Project definition + server files mixed | Minimal deploy structure (§2) |
| **Consumer** | MC Server Manager (run workspace, sync), optional push | Server root (extract and run), deployment targets (future) |

Deployment zips are derived from a **build**: filter the build artifact to include only server-runtime paths, so each deployment has a clear lineage (project + build id).

---

## 2. Final minimal deploy structure (target layout)

The deployment zip should produce a **clean bundle** that matches a standard Minecraft/Paper server layout. Two packaging options:

- **Option A (single top-level folder):** Zip entries live under one root folder (e.g. `<projectId>-<label>/` or `<projectName>-live/`). Unzip gives one folder to drop or use as server root.
- **Option B (flat):** Zip entries at root; user extracts into an empty server directory.

Recommendation: **Option A** so the bundle is self-describing and safe to extract anywhere.

**Target structure** (what the zip should contain, under the optional top-level folder):

```
<top-level-folder>/     e.g. teledosi-live/ or myproject-v1.2/
  config/
    paper-global.yml
    paper-world-defaults.yml
    ...                  (any project configs that live under config/)
  plugins/
    <plugin>.jar
    ...
  world/                 (optional: empty placeholder or omit)
  world_nether/
  world_the_end/
  server.properties      (root-level server config from build)
  bukkit.yml
  spigot.yml
  commands.yml
  help.yml
  permissions.yml
  wepif.yml
  ...                    (other project-defined root configs only)
```

**Included from build (server layout only):**

- **Root-level config files** – Build configs whose output path is at server root, **excluding** server auto-generated files (see below): e.g. `server.properties`, `bukkit.yml`, `spigot.yml`, `commands.yml`, `help.yml`, `permissions.yml`, `wepif.yml`, and any other project-defined root configs. Same paths as in the build artifact.
- **`config/*`** – All build config files under `config/` (e.g. `config/paper-global.yml`, `config/paper-world-defaults.yml`). Binary or text as in build.
- **`plugins/*.jar`** – Plugin JARs only at `plugins/<fileName>`.

**Excluded – server auto-generated (do not zip):**

These files are created or managed by the server at runtime. Do not include them in the deployment zip; the server will create or retain them when running.

- `eula.txt` – Created on first run; server exits until accepted.
- `usercache.json` – Filled as players connect.
- `ops.json` – Server creates/updates; deploying would overwrite live ops.
- `whitelist.json` – Same.
- `banned-ips.json`, `banned-players.json` – Same.

If the build artifact contains any of these (e.g. from a template), filter them out when building the deployment zip.

**Optional:**

- **Empty world dirs** – `world/`, `world_nether/`, `world_the_end/` as empty placeholder directories so the extracted tree matches a typical server layout. Implementation may omit them and let the server create them on first run.
- **Top-level folder** – One directory wrapping all entries (e.g. `<projectId>-<label>.zip` → contents under `<projectId>-<label>/`).

**Not produced by MC Server Manager (operator-supplied or out of scope):**

- **`server.jar`** – The Minecraft/Paper server binary is not part of the project build. The operator places it in the server root or it is added by another process. The deployment zip does not include it unless a future feature adds “bundle server binary.”
- **World data** – Actual world saves are runtime-generated; the zip does not include world data unless a future feature supports “include world snapshot.”

**Excluded (project-only, never in deployment zip):**

- `profiles/*` (e.g. `profiles/base.yml`)
- `plugins/registry.yml`
- `overlays/*`
- Any path that is not a server-runtime file (no project definition files).

---

## 3. Source of truth

- **Source:** A deployment zip is created **from a specific build** (by build id).
- **Requirements:** The build must exist, be **succeeded**, and have an **artifact** (build artifact path present).
- **Process:** Read the build artifact zip, filter entries to server-runtime paths only: (1) root-level config files (e.g. `server.properties`, `bukkit.yml`) **excluding** server auto-generated files (`eula.txt`, `usercache.json`, `ops.json`, `whitelist.json`, `banned-ips.json`, `banned-players.json`), (2) paths under `config/`, (3) paths under `plugins/` (plugin binaries only, e.g. `.jar`). Optionally wrap all entries under a single top-level folder and/or add empty `world/`, `world_nether/`, `world_the_end/` dirs. Write the new zip as the deployment artifact. No re-run of build steps; pure filter (and optional reshape) of the existing build zip.

This keeps a single source of truth (the build) and avoids divergence between “what was built” and “what was deployed.”

---

## 4. Deployment record (history)

Each created deployment is stored as a **deployment record** with at least:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique deployment id (e.g. UUID or timestamp-based). |
| `projectId` | string | Project this deployment belongs to. |
| `buildId` | string | Build id that was used to produce this deployment. |
| `createdAt` | string | ISO 8601 timestamp. |
| `label` | string (optional) | User-defined label or version (e.g. `"v1.2"`, `"prod-2025-03"`). |
| `artifactPath` | string | Absolute path to the deployment zip on disk. |
| `artifactSize` | number (optional) | Size in bytes. |
| `artifactSha256` | string (optional) | SHA-256 of the deployment zip. |

History is **append-only**: create new deployment records; no edit or delete of past records required for the initial scope.

---

## 5. Storage

- **Deployment zips:** Stored under a dedicated directory, e.g. `data/deployments/<projectId>/<deploymentId>.zip` (or under existing `DATA_DIR` with a `deployments/` subfolder). Exact path is an implementation detail.
- **History index:** A persistent store of deployment records (e.g. `deployments.json` per project, or a single store with `projectId` index) so the app can list deployments for a project and resolve artifact path for download.

---

## 6. API (backend)

- **Create deployment**
  - **Input:** `projectId`, `buildId`, optional `label`.
  - **Behavior:** Load build by id; verify status succeeded and artifact exists. Build artifact zip path may be from existing build queue/store. Filter zip to server layout; write deployment zip to storage; append deployment record to history; return deployment record.
  - **Errors:** 404 if build not found or no artifact; 400 if build not succeeded.

- **List deployments**
  - **Input:** `projectId` (optional: list all projects or filter by project).
  - **Output:** Array of deployment records (e.g. sorted by `createdAt` descending).

- **Get deployment**
  - **Input:** `deploymentId` (and optionally `projectId` for scoping).
  - **Output:** Full deployment record.

- **Download deployment artifact**
  - **Input:** `deploymentId`.
  - **Behavior:** Resolve artifact path from record; stream zip file (e.g. `Content-Disposition: attachment` with a filename like `deployment-<projectId>-<deploymentId>.zip` or `server-<label>-<timestamp>.zip`).

---

## 7. Deployments page (frontend)

- **Primary actions**
  - **Create deployment:** Choose project (and optionally a specific succeeded build; default to latest succeeded build). Optional label. Trigger create API; on success, show in history and optionally offer download.
- **History**
  - List deployments (for selected project or all). Show: label, build id, created at, size; actions: download.
- **Deployment targets (existing)**
  - Keep existing UI for defining folder/SFTP targets. No “publish” action required for this phase; the page can note that “Publish to target” will use deployment zips when implemented.

Subtitle or description can be updated from “Publish support is stubbed for now” to something like “Build server deployment zips and keep a history. Publish to targets coming later.”

---

## 8. Out of scope (later)

- **Publish to target:** Actually copying a deployment zip to a configured folder or SFTP target (current `publishBuildToTarget` stub). Will use deployment zip (or deployment id) as the source when implemented.
- **Deleting / pruning old deployments:** Not required for initial scope; can be added later (e.g. “keep last N” or “delete older than X”).
- **Creating a deployment from “current project state” without a build:** Possible future option; this spec ties deployment to a build for clear lineage.
- **Including `server.jar` in the zip:** The server binary is not produced by the project build; the operator adds it to the server root. A future feature could support “bundle server binary” (e.g. from a configured path or download).
- **Including world data:** Real `world/`, `world_nether/`, `world_the_end/` content is runtime-generated; the spec allows empty placeholder dirs only. Bundling world snapshots could be a later feature.

---

## 9. Implementation notes

- **Filtering the build zip:** Use the same zip library as build (e.g. AdmZip). Iterate entries; include if (1) path is a root-level server config **and** not in the server auto-generated exclude list (`eula.txt`, `usercache.json`, `ops.json`, `whitelist.json`, `banned-ips.json`, `banned-players.json`), (2) path is under `config/`, or (3) path is under `plugins/` and is a plugin binary (e.g. `.jar`). Exclude anything under `profiles/`, `overlays/`, or `plugins/registry.yml`. Reuse path conventions from the build so the deployment zip matches the minimal deploy structure.
- **Top-level folder:** If Option A is used, prefix every included entry with `<projectId>-<label>/` (or similar); when the user unzips they get one folder containing the full server layout.
- **Placeholder world dirs:** If including empty `world/`, `world_nether/`, `world_the_end/`, add zero-byte placeholder entries or empty dir entries so extractors create the directories.
- **Naming:** Deployment zip filename can be `server-<projectId>-<deploymentId>.zip` or include label, e.g. `<projectId>-<label>.zip` or `server-<projectId>-<label>-<shortTimestamp>.zip` for readability.
- **Build artifact path:** Builds currently store `artifactPath` (e.g. on `BuildJob`). Deployment creation reads that path to open the build zip; no change to build output format required.

---

## 10. Summary

| Item | Decision |
|------|----------|
| Deployment zip contents | Minimal deploy structure: root-level server configs (excluding auto-generated eula.txt, usercache.json, ops.json, whitelist.json, banned-*.json) + `config/` + `plugins/*`; optional top-level folder; optional empty world dirs. No `server.jar` (operator-supplied). |
| Source | Filter from an existing succeeded build artifact. |
| History | Append-only deployment records (id, projectId, buildId, createdAt, label, artifactPath, optional size/sha). |
| Storage | Dedicated deployment dir + history index (e.g. JSON store). |
| API | Create (projectId, buildId, label), List (projectId?), Get (id), Download (id). |
| UI | Create deployment from project/build; list history; download. Publish to targets later. |

This gives a clear path to “proper server deployment zips with a history of each build” on the Deployments page, independent of the build pipeline, and leaves publishing to folder/SFTP for a follow-up.
