# Source File Versioning

## Overview

Commit project source files (configs, profiles, plugin registry) to GitHub alongside build artifacts. Currently only manifests and ZIP artifacts are committed, making it impossible to see actual config changes between builds.

## Current State

- Builds commit to GitHub with:
  - `manifests/<buildId>.json` - build manifest with checksums
  - `dist/<buildId>.zip` - compiled artifact
- Project source files exist only locally:
  - `profiles/` - base.yml and profile configurations
  - `configs/` - server config templates (server.properties.hbs, etc.)
  - `plugins/registry.yml` - plugin definitions
  - `overlays/` - environment-specific overrides
- Manifests track **checksums** of configs, but not the actual content
- **No way to see what changed** in a config between builds
- Users must manually track changes or lose history

## Enhancement

### Commit Source Files with Builds

Include project source files in build commits so every build captures the full state.

**Files to commit:**
```
profiles/
  base.yml
  [other profiles]
configs/
  server.properties.hbs
  paper-global.yml.hbs
  [other templates]
plugins/
  registry.yml
overlays/
  dev.yml
  live.yml
```

**Resulting repo structure:**
```
repo/
  profiles/           <- NEW: committed source files
  configs/            <- NEW: committed source files
  plugins/            <- NEW: committed source files
  overlays/           <- NEW: committed source files
  manifests/
    2026-01-30T15-24-01-456Z.json
  dist/
    2026-01-30T15-24-01-456Z.zip
```

### Commit Strategy

**Option A: Bundle with Build Commits**
- Every build commit includes current source files
- Single commit contains: source files + manifest + artifact
- Pros: Simple, atomic, always in sync
- Cons: Source changes only captured at build time

**Option B: Separate Source Commits**
- Commit source files independently when changed
- Build commits reference source state via commit SHA
- Pros: More granular history, captures changes between builds
- Cons: More complex, multiple commits

**Recommendation: Option A** for MVP simplicity. Option B can be added later for users who want real-time versioning.

### What Gets Committed

| Path | Description | Include |
|------|-------------|---------|
| `profiles/*.yml` | Profile configurations | Yes |
| `configs/*.hbs` | Config templates | Yes |
| `configs/*.yml` | Static configs | Yes |
| `plugins/registry.yml` | Plugin definitions | Yes |
| `overlays/*.yml` | Environment overrides | Yes |
| `assets/worlds/` | World snapshots | Optional (large) |
| `assets/datapacks/` | Datapacks | Optional (large) |

### Handling Large Files

World snapshots and datapacks can be large. Options:
1. **Exclude by default** - only commit text configs
2. **Git LFS** - use Large File Storage for binary assets
3. **User toggle** - let users choose what to include

Recommend: Exclude large binary assets initially, add LFS support later.

## Implementation

### 1. Update `pushBuildToRepository`

Modify `backend/src/services/buildQueue.ts`:

```typescript
async function pushBuildToRepository(params, githubToken) {
  // ... existing setup ...

  // Collect source files
  const sourceFiles = await collectSourceFiles(params.project);
  
  const files = {
    // Existing
    [`manifests/${params.buildId}.json`]: params.manifestContent,
    [params.artifactRelativePath]: { content: zipBuffer, encoding: "base64" },
    
    // NEW: Source files
    ...sourceFiles,
  };

  await commitFiles(octokit, { ...options, files });
}
```

### 2. New Function: `collectSourceFiles`

```typescript
async function collectSourceFiles(project: StoredProject): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const projectDir = getProjectDir(project.id);
  
  // Profiles
  const profilesDir = path.join(projectDir, "profiles");
  for (const file of await readdir(profilesDir)) {
    if (file.endsWith(".yml") || file.endsWith(".yaml")) {
      const content = await readFile(path.join(profilesDir, file), "utf-8");
      files[`profiles/${file}`] = content;
    }
  }
  
  // Configs
  const configsDir = path.join(projectDir, "configs");
  for (const file of await readdir(configsDir)) {
    const content = await readFile(path.join(configsDir, file), "utf-8");
    files[`configs/${file}`] = content;
  }
  
  // Plugin registry
  const registryPath = path.join(projectDir, "plugins", "registry.yml");
  if (await exists(registryPath)) {
    files["plugins/registry.yml"] = await readFile(registryPath, "utf-8");
  }
  
  // Overlays
  const overlaysDir = path.join(projectDir, "overlays");
  if (await exists(overlaysDir)) {
    for (const file of await readdir(overlaysDir)) {
      if (file.endsWith(".yml") || file.endsWith(".yaml")) {
        const content = await readFile(path.join(overlaysDir, file), "utf-8");
        files[`overlays/${file}`] = content;
      }
    }
  }
  
  return files;
}
```

### 3. Update Commit Message (Optional)

Include summary of source changes in commit message:

```
build: teledosi (2026-01-30T15-24-01-456Z)

Source files:
- profiles/base.yml (modified)
- configs/server.properties.hbs
- plugins/registry.yml (modified)
```

### 4. Handle Existing Repos

For projects with existing GitHub repos:
- First build after this feature will commit all source files
- Subsequent builds will show diffs naturally
- No migration needed

## Benefits

- **Real diffs:** See exactly what changed in configs between builds
- **Full history:** Track evolution of server configuration over time
- **Audit trail:** Know who changed what and when
- **Recovery:** Restore any previous configuration state
- **Collaboration:** Team members can see and review config changes
- **No extra steps:** Happens automatically with every build

## Priority

**High** - This is a prerequisite for the Diff & History UI to be useful. Without source files in the repo, there's nothing meaningful to diff. Relatively low implementation effort with high value.

## Dependencies

- None (standalone enhancement)
- Enables: `diff-history-ui.md` becomes more valuable
- Related: `github-pending-commits.md` (commit reliability)

## Future Enhancements

1. **Real-time commits** - Commit on file save, not just build
2. **Git LFS** - Support for large world snapshots
3. **Selective sync** - Choose which files to version
4. **Branch per environment** - Different branches for dev/live configs
