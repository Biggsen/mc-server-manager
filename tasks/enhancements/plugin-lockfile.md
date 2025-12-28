# Plugin Lockfile Generation

## Overview

Generate a `plugins/lock.yml` file that records the exact resolved versions, URLs, and checksums of all plugins used in a build. This provides reproducibility and allows verification of plugin integrity.

## Current State

- Plugin versions are pinned in profiles
- Plugins are resolved and downloaded during builds
- SHA-256 checksums are computed for plugins
- **No lockfile is generated** - resolved plugin metadata is not persisted

## Enhancement

Generate a lockfile after plugin resolution that contains:

```yaml
lockSchema: 1
resolved:
  worldguard:
    version: "7.0.10"
    url: "https://hangar.papermc.io/api/v1/projects/EngineHub/WorldGuard/versions/7.0.10/builds/123/downloads/WorldGuard-7.0.10.jar"
    sha256: "abc123..."
    provider: "hangar"
    resolvedAt: "2025-01-15T10:30:00Z"
  placeholderapi:
    version: "2.11.6"
    url: "https://github.com/PlaceholderAPI/PlaceholderAPI/releases/download/2.11.6/PlaceholderAPI-2.11.6.jar"
    sha256: "def456..."
    provider: "github"
    resolvedAt: "2025-01-15T10:30:05Z"
```

## Implementation

1. **Generate lockfile during build:**
   - After all plugins are resolved and downloaded
   - Write to `plugins/lock.yml` in project root
   - Include in build artifact and commit to GitHub

2. **Use lockfile for verification:**
   - On subsequent builds, verify resolved plugins match lockfile
   - Warn if versions differ
   - Option to update lockfile or use existing

3. **Lockfile format:**
   - YAML format for readability
   - Include schema version for future compatibility
   - Store all metadata needed for reproducibility

## Benefits

- **Reproducibility:** Exact same plugin versions across builds
- **Verification:** Detect when plugin sources change
- **Audit trail:** Record of what was used in each build
- **Offline builds:** Can use cached plugins if URLs are still valid

## Priority

**Low** - MVP works without this. Plugin versions are already pinned in profiles, so reproducibility is mostly achieved. Lockfile adds extra verification and audit capabilities.

