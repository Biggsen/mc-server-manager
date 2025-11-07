# MC Server Manager – Specification (v0.1)

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
| Feature | Description |
|----------|--------------|
| **Project Manager UI** | Web or desktop UI to create and manage server projects. |
| **GitHub Integration** | Each project is stored in its own GitHub repo for version control. |
| **Resource Uploads** | Upload worlds, datapacks, plugin JARs, and config folders directly. |
| **Visual Configuration** | Form-based editing for common files like `server.properties`, `paper-global.yml`, etc. |
| **Build System** | Generates a ready-to-run server package (ZIP + manifest). |
| **Run Locally** | Starts the server in a local Docker container for testing. |
| **Deploy** | Pushes built packages to a local folder or remote host (SFTP). |
| **Overlays** | Allow environment variations (dev/live) without duplicating config files. |
| **Diff & History** | View what changed between builds via GitHub commits and manifests. |

---

## Repo Structure
### 🗂️ Main Manager Repository
```
mc-server-manager/
  frontend/          # React or SvelteKit UI
  backend/           # Node API for builds, validation, GitHub commits
  templates/         # Default scaffold for new projects
  docker/            # Optional Docker setup for Run Locally
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
1. **New Project → “Paper Server”**
   - Enter project name and Minecraft version.
   - Choose or auto-generate GitHub repo.
   - Select server type (Paper, Purpur, etc.).

2. **World Setup**
   - Option 1: Upload an existing world ZIP.  
   - Option 2: Generate a new world with:  
     - World name  
     - Seed (text or numeric)  
     - World type (`default`, `flat`, etc.)  
     - Structures on/off  

3. **Upload Resources**
   - **Datapacks:** e.g. `gmexplore/`  
   - **Plugins:** pick from registry or upload `.jar`  
   - **Configs:** drop plugin folders (e.g. WorldGuard, CrazyCrates)

4. **Configure Server**
   - Edit key settings in the UI:  
     - `server.properties`  
     - `paper-global.yml`  
     - MOTD, player limits, view/simulation distance, etc.  
   - Add **Overlays** for dev/live differences.

5. **Version Control**
   - Every upload/edit = a GitHub commit.
   - UI shows history and diffs between commits.

6. **Build**
   - One click → assembles:  
     - Paper jar (pinned version)  
     - All plugin jars  
     - Datapacks + configs  
     - Generated `server.properties`, etc.  
   - Produces `/dist/server-build.zip` and a `manifest.json`.

7. **Run Locally**
   - Starts a Docker container using the build ZIP.  
   - Streams console output to the UI.  
   - Generates world folder automatically if not present.  
   - Shuts down cleanly after confirmation that startup succeeded.

8. **Deploy**
   - Deploy to a local folder or remote host (via SFTP).  
   - Keeps a list of releases and supports rollback.

---

## Build Pipeline Summary
1. Validate YAML/configs (schema + sanity checks).  
2. Resolve plugin versions from registry.  
3. Download/update jars and cache them.  
4. Assemble all assets into a single server package.  
5. Verify checksums and produce manifest.  
6. Optionally run smoke tests in Docker.  
7. Output ZIP and log results.

---

## Tech Stack
| Layer | Choice |
|--------|--------|
| **Frontend** | React + Vite or SvelteKit (TypeScript) |
| **Backend** | Node.js + Express/Fastify |
| **Auth & Storage** | GitHub OAuth + GitHub API (for repos and commits) |
| **Builds** | Node script (downloads, templates, manifest) |
| **Testing** | Docker SDK (for local runs) |
| **Config Format** | YAML + JSON Schema for validation |

---

## Planned MVP Scope
✅ Paper support only  
✅ Local build & run  
✅ Basic GitHub repo sync  
✅ File upload for datapacks, plugins, configs  
✅ Basic templated server settings  
✅ Build → Run → Deploy workflow  

---

## Future Extensions
- Plugin registry auto-update checker.  
- Fabric / Forge loader support.  
- Webhooks for “build succeeded” notifications.  
- Shared presets (e.g. “Exploration Server”, “Creative Hub”).  
- Team roles / multi-user collaboration.  

---

## Initial Setup Steps
1. Create repo: `mc-server-manager`.  
2. Add basic frontend + backend scaffolds.  
3. Create a default `templates/server/` scaffold.  
4. Implement “New Project” flow with GitHub repo creation.  
5. Add upload handling (worlds, plugins, configs).  
6. Build & test pipeline (manual trigger).  
7. Add Docker “Run Locally” option.  
8. Add deployment options.

---

## Next Action
Create the repo → `mc-server-manager`  
Then add a `docs/` folder for this spec and future architecture notes.
