# **Clarifications – MC Server Manager**

## **1. Overlays: Merge / Override Rules**

**Order of application:**

1. `copyTrees`
2. rendered templates
3. base profile `overrides`
4. overlay `overrides`

**Rules:**

* YAML/JSON → deep merge by key
* Arrays → full replace unless `mergePolicy.arrays` is set to `append` or `uniqueAppend`
* `.properties` files → key-by-key replacement
* Paths use `:` to address keys

  * Example: `server.properties:max-players`
  * Example: `paper-global.yml:chunk-system.target-tick-distance`

**Example**

```yaml
# profiles/base.yml
configs:
  files:
    - template: server.properties.hbs
      output: server.properties
      data:
        motd: "Charidh Dev"
        maxPlayers: 20
overrides:
  - path: "server.properties:view-distance"
    value: 16

# overlays/live.yml
overrides:
  - path: "server.properties:max-players"
    value: 60
  - path: "paper-global.yml:chunk-system.target-tick-distance"
    value: 6
```

**Result**

* `max-players` = 60 (overlay wins)
* `view-distance` = 16 (base kept)

**Optional array policy**

```yaml
mergePolicy:
  arrays: "replace"   # replace | append | uniqueAppend
```

---

## **2. Plugin Registry: Shape & Versioning**

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

**Pin versions in profile**

```yaml
plugins:
  - id: worldguard
    version: "7.0.10"
  - id: placeholderapi
    version: "^2.11.6"
```

**Generated lockfile (`plugins/lock.yml`):**

```yaml
lockSchema: 1
resolved:
  worldguard:
    version: "7.0.10"
    url: "https://..."
    sha256: "..."
  placeholderapi:
    version: "2.11.6"
    url: "https://..."
    sha256: "..."
```

---

## **3. GitHub Quotas & Fallbacks**

**Normal usage:** minimal API calls — unlikely to hit limits.

**Fallbacks:**

* **Local-first mode:** keep working offline; queue commits for later push.
* **Retry with backoff:** handle transient rate limits or 5xx errors.
* **Manual export:** always allow “Download Project ZIP.”
* **Deferred repo creation:** create locally first; connect to GitHub later.

**Failure handling:**

* Repo creation fail → keep local; show error; allow retry.
* Commit fail → write to `pending-commits/` queue for later push.
* Push conflict → auto-fetch & rebase or create fallback PR branch.

---

## **4. Docker Support Scope**

**MVP setup:**

* Single Docker daemon on the manager host.
* Each project runs in an isolated container (`<project>-run`).
* Volumes map build ZIP → `/srv/server/` inside container.
* No Docker install needed for users if the manager is hosted centrally.

**Desktop mode:**

* If manager runs locally, uses user’s Docker Desktop.

**Runtime base image:**
`eclipse-temurin:17-jre` + Paper JAR (mounted).

---

## **5. Manifest Requirements & Checksums**

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

**Checksum algorithm:**

* `SHA-256` for:

  * Plugin JARs
  * Config files
  * Datapack folders (deterministic folder hash)
  * Final ZIP artifact

**Determinism:**

* Normalize to UTF-8 + LF before hashing text configs.
* Sort file paths when hashing folders.
* Zip with fixed timestamps to ensure consistent hashes.

---

## **6. Overlay Example**

```yaml
# overlays/dev.yml
configs:
  files:
    - template: server.properties.hbs
      output: server.properties
      data:
        motd: "[DEV] Charidh"
        maxPlayers: 10
overrides:
  - path: "server.properties:enforce-secure-profile"
    value: "false"

# overlays/live.yml
overrides:
  - path: "server.properties:max-players"
    value: 60
  - path: "server.properties:online-mode"
    value: "true"
mergePolicy:
  arrays: "replace"
```

---

This file can live in your repo as `docs/clarifications.md` or be appended to your main spec.

