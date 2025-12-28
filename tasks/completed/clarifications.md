# **Clarifications – MC Server Manager**

## **1. Plugin Registry: Shape & Versioning** ✅ Implemented

**File:** `plugins/registry.yml`

Defines where and how to fetch plugins.

```yaml
schema: 1
plugins:
  worldguard:
    displayName: "WorldGuard"
    sources:
      - type: "hangar"
        project: "EngineHub/WorldGuard"
        filePattern: "WorldGuard-*.jar"

  placeholderapi:
    displayName: "PlaceholderAPI"
    sources:
      - type: "github"
        repo: "PlaceholderAPI/PlaceholderAPI"
        assetPattern: "PlaceholderAPI-*.jar"

  crazycrates:
    displayName: "CrazyCrates"
    sources:
      - type: "spigot"
        resourceId: 17599
```

**Pin versions in profile** ✅ Implemented

Only exact versions are supported (no semver ranges). Specify the exact version string as provided by the plugin source.

```yaml
plugins:
  - id: worldguard
    version: "7.0.10"
  - id: placeholderapi
    version: "2.11.6"
```

**Note:** Plugin lockfile generation is planned as a future enhancement (see `tasks/enhancements/plugin-lockfile.md`).

---

## **2. GitHub Quotas & Fallbacks** ✅ Partially Implemented

**Normal usage:** minimal API calls — unlikely to hit limits.

**Implemented fallbacks:**

* ✅ **Retry with backoff:** handle transient rate limits or 5xx errors (via Octokit throttling plugin).
* ✅ **Manual export:** always allow "Download Project ZIP."
* ✅ **Deferred repo creation:** create locally first; connect to GitHub later.

**Failure handling:**

* ✅ Repo creation fail → keep local; show error; allow retry.
* ⚠️ Commit fail → build may fail or commit is lost (pending commits queue is planned as enhancement).

**Planned enhancements:**

* Local-first mode with pending commits queue (see `tasks/enhancements/github-pending-commits.md`).
* Auto-fetch & rebase on push conflicts (see `tasks/enhancements/github-conflict-resolution.md`).

---

## **3. Docker Support Scope** ✅ Implemented

**Implementation:**

* ✅ Uses the `itzg/minecraft-server:latest` Docker image, which automatically handles server setup and execution.
* ✅ Single Docker daemon on the manager host.
* ✅ Each project runs in an isolated container (named `<project>-<runId>`).
* ✅ Build artifact (ZIP) is extracted to a workspace directory, which is mounted to `/data` inside the container.
* ✅ The image downloads and runs the server JAR automatically based on environment variables:
  * `TYPE`: Server type (e.g., `PAPER`, `PURPUR`)
  * `VERSION`: Minecraft version (e.g., `1.21.1`)
  * `PAPERBUILD`: Paper build number (if specified, e.g., `54`)
  * `EULA=TRUE`: Accepts Minecraft EULA
  * `USE_AIKAR_FLAGS=true`: Uses optimized JVM flags
  * `MEMORY=4G`: Allocated memory
* ✅ Port mapping: Host port (auto-selected) → Container port 25565.
* ✅ Container runs with `--rm` flag (automatically removed on exit).

**Desktop mode:**

* ✅ If manager runs locally, uses user's Docker Desktop.
* ✅ Falls back to simulation mode if Docker is not found on PATH.

**Workspace persistence:**

* ✅ Workspace directory persists between runs for the same project.
* ✅ Files are synced from the latest build artifact, preserving world data and config edits.

---

## **4. Manifest Requirements & Checksums** ✅ Implemented

**File:** `dist/manifest.json`

**Example:**

```json
{
  "schema": 1,
  "project": "charidh-explore",
  "buildId": "2025-11-07T00-42-13Z",
  "minecraft": { "loader": "paper", "version": "1.21.1" },
  "world": { "mode": "generated", "seed": "12345", "name": "world" },
  "plugins": [
    { "id": "worldguard", "version": "7.0.10", "sha256": "<jar-hash>" },
    { "id": "placeholderapi", "version": "2.11.6", "sha256": "<jar-hash>" }
  ],
  "datapacks": [
    { "id": "gmexplore", "path": "world/datapacks/gmexplore", "sha256": "<folder-hash>" }
  ],
  "configs": [
    { "path": "server.properties", "sha256": "<file-hash>" },
    { "path": "config/paper-global.yml", "sha256": "<file-hash>" }
  ],
  "artifact": {
    "zipPath": "dist/charidh-explore-paper-1.21.1-20251107-004213.zip",
    "sha256": "<artifact-hash>",
    "size": 12345678
  }
}
```

**Checksum algorithm:** ✅ Implemented

* `SHA-256` for:

  * ✅ Plugin JARs
  * ✅ Config files
  * ✅ Datapack folders (deterministic folder hash)
  * ✅ Final ZIP artifact

**Determinism:**

* ✅ Zip with fixed timestamps to ensure consistent hashes.

**Planned enhancements:**

* UTF-8 + LF normalization before hashing text configs (see `tasks/enhancements/deterministic-config-hashing.md`).
* Sort file paths when hashing folders (see `tasks/enhancements/deterministic-folder-hashing.md`).

---

This file can live in your repo as `docs/clarifications.md` or be appended to your main spec.

