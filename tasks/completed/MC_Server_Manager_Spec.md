# MC Server Manager – Specification (v1.0)

## Overview
**MC Server Manager** is a UI-based tool for creating, configuring, and deploying fully-set-up Minecraft servers (e.g., Paper).  
It replaces the usual manual setup steps (downloading JARs, adding plugins, editing configs, etc.) with a visual, GitHub-backed workflow.

Each server you make is a **self-contained project** stored in its own GitHub repo, versioned and reproducible.

---

## Core Idea
You don’t “run” a server first — you **define** it.

You configure everything through the UI (Minecraft version, plugins, datapacks, configs, world seed).  
Then, when ready, you build and test that definition locally or deploy it to a host.

---

## Main Features
| Feature | Status | Description |
|----------|--------|--------------|
| **Project Manager UI** | ✅ Implemented | Web UI to create and manage server projects. |
| **GitHub Integration** | ✅ Implemented | Each project is stored in its own GitHub repo for version control. |
| **Resource Uploads** | ⚠️ Partial | Upload plugin JARs and config files directly. World upload/generation UI pending. |
| **Visual Configuration** | ⚠️ Partial | One-time profile generation exists. Ongoing form-based editing pending. |
| **Build System** | ✅ Implemented | Generates a ready-to-run server package (ZIP + manifest). |
| **Run Locally** | ✅ Implemented | Starts the server in a local Docker container for testing. |
| **Deploy** | ✅ Implemented | Pushes built packages to a local folder or remote host (SFTP). |
| **Overlays** | ⚠️ Partial | Overlay files exist and arrays merge, but path-based overrides pending. |
| **Diff & History** | ❌ Planned | View what changed between builds via GitHub commits and manifests. |

**Status Legend:**
- ✅ Implemented - Feature is complete and working
- ⚠️ Partial - Feature exists but incomplete
- ❌ Planned - Feature is specified but not yet implemented

---

## Repo Structure
### 🗂️ Main Manager Repository
```
mc-server-manager/
  frontend/          # React + Vite + Mantine UI (TypeScript)
  backend/           # Node.js + Express API (TypeScript)
  templates/         # Default scaffold for new projects
  data/              # File-based JSON storage (projects, builds, runs, deployments)
  package.json
  README.md
```

### 🗂️ Example Generated Project Repo
```
mc-charidh-explore/
  assets/
    worlds/          # optional, populated after first run
    datapacks/
    configs/
  plugins/
    registry.yml
  profiles/
    base.yml
  overlays/
    dev.yml
    live.yml
  README.md
```

---

## Project Creation Flow

1. **New Project → "Paper Server"** ✅
   - Enter project name and Minecraft version.
   - Choose or auto-generate GitHub repo.
   - Select server type (Paper, Purpur, etc.).

2. **World Setup** ❌ *[MVP Gap - see `tasks/enhancements/world-setup-ui.md`]*
   - Option 1: Upload an existing world ZIP.  
   - Option 2: Generate a new world with:  
     - World name  
     - Seed (text or numeric)  
     - World type (`default`, `flat`, etc.)  
     - Structures on/off  
   - *Note: World configuration exists in profiles, but no UI for upload/generation yet.*

3. **Upload Resources** ⚠️
   - **Plugins:** ✅ Pick from registry or upload `.jar`  
   - **Configs:** ✅ Upload config files directly  
   - **Datapacks:** ⚠️ Can be uploaded but no dedicated UI flow

4. **Configure Server** ⚠️ *[MVP Gap - see `tasks/enhancements/visual-config-forms.md`]*
   - One-time profile generation exists via `GenerateProfile` page
   - **Pending:** Ongoing form-based editing in Project Detail page
   - Settings include:  
     - `server.properties` (MOTD, player limits, view/simulation distance, etc.)
     - `paper-global.yml` (target tick distance, etc.)
   - **Overlays:** ⚠️ Files exist, but path-based overrides not yet applied

5. **Version Control** ⚠️ *[MVP Gap - see `tasks/enhancements/diff-history-ui.md`]*
   - ✅ Every upload/edit = a GitHub commit.
   - ❌ UI shows history and diffs between commits. *[Pending]*

6. **Build** ✅
   - One click → assembles:  
     - Paper jar (pinned version)  
     - All plugin jars (downloaded and cached)  
     - Datapacks + configs  
     - Generated `server.properties`, etc.  
   - Produces `/dist/server-build.zip` and a `manifest.json` with SHA-256 checksums.

7. **Run Locally** ✅
   - Starts a Docker container using `itzg/minecraft-server` image.  
   - Streams console output to the UI via Server-Sent Events (SSE).  
   - Uses persistent project workspaces (preserves world data between runs).  
   - Interactive console access for commands.  
   - Generates world folder automatically if not present.  

8. **Deploy** ✅
   - Deploy to a local folder or remote host (via SFTP).  
   - Deployment targets can be configured and reused.

---

## Build Pipeline Summary
1. ✅ Validate YAML/configs (schema + sanity checks).  
2. ✅ Resolve plugin versions from registry (`plugins/registry.yml`).  
3. ✅ Download/update jars and cache them (with SHA-256 checksums).  
4. ✅ Assemble all assets into a single server package.  
5. ✅ Verify checksums and produce manifest (`manifest.json`).  
6. ✅ Commit build artifacts to GitHub (if configured).  
7. ✅ Output ZIP and log results.

**Implementation Details:**
- Plugin registry supports Hangar, GitHub Releases, and Spigot sources
- Build queue system manages concurrent builds
- Manifest includes project metadata, plugin versions, config checksums, and artifact info
- Build artifacts stored in `data/builds/dist/`

---

## Tech Stack
| Layer | Choice | Status |
|--------|--------|--------|
| **Frontend** | React + Vite + Mantine (TypeScript) | ✅ Implemented |
| **Backend** | Node.js + Express (TypeScript) | ✅ Implemented |
| **Storage** | File-based JSON storage | ✅ Implemented |
| **Auth** | GitHub OAuth + GitHub API | ✅ Implemented |
| **Builds** | Node script (downloads, templates, manifest) | ✅ Implemented |
| **Local Runs** | Docker (`itzg/minecraft-server` image) | ✅ Implemented |
| **Config Format** | YAML (Handlebars templates) + JSON Schema | ✅ Implemented |
| **Log Streaming** | Server-Sent Events (SSE) | ✅ Implemented |

---

## MVP Scope Status

### ✅ Completed
- Paper support only  
- Local build & run  
- Basic GitHub repo sync  
- File upload for plugins and configs  
- Basic templated server settings  
- Build → Run → Deploy workflow  
- Persistent project workspaces for local runs
- Interactive console access
- Plugin registry with caching
- Manifest generation with checksums

### ❌ MVP Gaps
- **World Setup UI** - Upload/generate worlds through UI (see `tasks/enhancements/world-setup-ui.md`)
- **Visual Configuration Forms** - Ongoing form-based editing (see `tasks/enhancements/visual-config-forms.md`)
- **Diff & History UI** - View commit history and build diffs (see `tasks/enhancements/diff-history-ui.md`)

### ⚠️ Partially Implemented
- **Overlays** - Files exist and arrays merge, but path-based overrides not yet applied (see `tasks/enhancements/overlays-spec.md`)

---

## Future Extensions

See `tasks/enhancements/README.md` for detailed enhancement specifications.

**High Priority Enhancements:**
- World Setup UI (MVP gap)
- Visual Configuration Forms (MVP gap)
- Diff & History UI (MVP gap)
- Overlays - complete override system

**Medium Priority:**
- GitHub Pending Commits Queue
- Plugin Config Path Management

**Low Priority:**
- Plugin registry auto-update checker
- Plugin lockfile generation
- Deterministic config/folder hashing improvements
- GitHub conflict resolution
- Fabric / Forge loader support
- Webhooks for "build succeeded" notifications
- Shared presets (e.g. "Exploration Server", "Creative Hub")
- Team roles / multi-user collaboration

---

## Implementation Details

### Docker Local Runs
- Uses `itzg/minecraft-server:latest` Docker image
- Environment variables: `TYPE`, `VERSION`, `PAPERBUILD`, `EULA=TRUE`, `USE_AIKAR_FLAGS=true`, `MEMORY=4G`
- Port mapping: Host port (auto-selected) → Container port 25565
- Workspace persistence: Project-scoped workspaces at `data/runs/workspaces/<projectId>`
- Interactive console: Commands sent via stdin, output streamed via SSE

### Manifest Format
- Schema version 1
- Includes: project ID, build ID, Minecraft version, world config, plugins (with SHA-256), configs (with SHA-256), artifact info
- Stored in `data/builds/manifests/<projectId>/<buildId>.json`
- Committed to GitHub with build artifacts

### Plugin Registry
- File: `plugins/registry.yml`
- Supports multiple sources: Hangar, GitHub Releases, Spigot
- Plugin versions pinned in profiles (`profiles/base.yml`)
- Exact versions only (no semver ranges)
- Cached downloads with SHA-256 verification

### Storage
- File-based JSON storage in `backend/data/`
- Stores: projects, builds, runs, deployments, plugins
- Version control friendly (can be committed to git)

---

## Documentation

- **Main Spec:** This document
- **Clarifications:** `tasks/completed/clarifications.md` - Implementation details and decisions
- **Enhancements:** `tasks/enhancements/README.md` - Planned enhancements and MVP gaps
- **Project Summary:** `tasks/mc-server-manager-project-summary.md` - Current implementation status
