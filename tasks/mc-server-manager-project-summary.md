<!-- PROJECT-MANIFEST:START -->
```json
{
  "schemaVersion": 1,
  "projectId": "mc-server-manager",
  "name": "MC Server Manager",
  "repo": "Biggsen/mc-server-manager",
  "visibility": "private",
  "status": "active",
  "domain": "minecraft",
  "type": "tool",
  "lastUpdated": "2026-01-12",
  "links": {
    "prod": null,
    "staging": null
  },
  "tags": ["minecraft", "server-management", "typescript", "react", "docker"]
}
```
<!-- PROJECT-MANIFEST:END -->

# MC Server Manager - Project Summary

## Project Overview

**MC Server Manager** is a UI-based tool for creating, configuring, and deploying fully-set-up Minecraft servers (specifically Paper). It replaces the usual manual setup steps (downloading JARs, adding plugins, editing configs, etc.) with a visual, GitHub-backed workflow.

Each server you make is a **self-contained project** stored in its own GitHub repository, making it versioned and reproducible.

### Core Philosophy

You don't "run" a server first — you **define** it. You configure everything through the UI (Minecraft version, plugins, datapacks, configs, world seed), then when ready, you build and test that definition locally or deploy it to a host.

### Key Features

- Visual server configuration through web UI
- GitHub-backed project storage and versioning
- Plugin library with version management
- Build system for generating server packages
- Local Docker-based testing
- Deployment to local folders and remote hosts via SFTP

---

## Tech Stack

- **Frontend**: React + Vite + TypeScript with Mantine UI components
- **Backend**: Node.js + Express + TypeScript
- **Storage**: File-based JSON storage for projects, builds, runs, deployments, and plugins
- **Authentication**: GitHub OAuth integration
- **Local Testing**: Docker-based runs using `itzg/minecraft-server` container
- **Deployment**: Local folders and SFTP for remote hosts

### Project Structure

- `frontend/` – React + Vite TypeScript UI
- `backend/` – Express-based API with TypeScript build pipeline
- `templates/server/` – Seed content for new server project repos
- `tasks/` – Specifications, enhancements, and completed task documentation

---

## Current Focus

Currently focused on **MVP gap features** to complete the core specification:
- **World Setup UI** - Upload/generate worlds through UI (high priority MVP gap)
- **Visual Configuration Forms** - Ongoing form-based editing for server configs (high priority MVP gap)
- **Diff & History UI** - View commit history and build diffs (medium priority MVP gap)

---

## Features (Done)

- [x] Project Management - Create new server projects with GitHub repository integration, import existing projects, manage project settings and metadata, GitHub OAuth authentication
- [x] Plugin Library - Upload and manage plugin JARs, version tracking, plugin registry with caching system, plugin metadata storage
- [x] Asset Management - Upload configuration files, datapacks, and world files with file organization and tracking
- [x] Build System - Generate server packages (ZIP + manifest), plugin version resolution, plugin JAR downloading and caching, build queue management, artifact storage and retrieval
- [x] Local Runs - Docker-based server execution, real-time log streaming via Server-Sent Events (SSE), run history tracking, run status management (running, succeeded, failed, stopped), persistent project workspaces, interactive console access
- [x] Deployments - Deploy to local folders and remote hosts via SFTP, deployment target management, build-to-deployment workflow
- [x] UI/UX System - Modern, cohesive interface with design tokens, component system (Button, Card, Badge, Tabs, Table, Toast, Skeleton), layout primitives (AppShell, MainCanvas, ContentSection), async action handling with loading states, toast notifications, responsive design (1280px+ desktop, tablet support)
- [x] UI/UX Overhaul - Complete redesign per `tasks/completed/ui-ux-overhaul.md`
- [x] Design Token System - Comprehensive design system with component library
- [x] Local Run Improvements - Persistent project workspaces, interactive console access, workspace reset capabilities (see `tasks/completed/local-run-improvements.md`)
- [x] Plugin Config Path Management - Plugin library config definitions, project-level config mappings, guided config upload flows (see `tasks/completed/manage-plugin-config-paths.md`)
- [x] Electron App Conversion - Standalone Electron desktop app with integrated backend server and native window (see `tasks/enhancements/README.md`)

### Detailed Completed Features

#### Project Management
- Full CRUD operations for server projects
- GitHub repository creation and integration
- Project metadata management
- GitHub OAuth authentication flow

#### Plugin Library
- Plugin JAR upload and storage
- Version tracking and management
- Plugin registry with caching
- Metadata storage and retrieval

#### Build System
- Server package generation (ZIP + manifest)
- Plugin version resolution
- Automated plugin JAR downloading
- Build queue management
- Artifact storage and retrieval

#### Local Runs
- Docker container integration (`itzg/minecraft-server` image)
- Real-time log streaming via SSE
- Run history tracking
- Status management (running, succeeded, failed, stopped)
- Persistent project workspaces (preserves world data between runs)
- Interactive console access (command sending via stdin)
- Workspace reset capabilities

#### Electron App
- Standalone desktop application
- Integrated backend server
- Native window interface
- Single executable packaging

#### UI Pages
- **Dashboard**: Project overview, activity feed, quick actions
- **Projects**: List view with filtering and search
- **Project Detail**: Multi-tab interface (Overview, Assets, Builds, Runs, Repository, Settings)
- **Plugin Library**: Plugin management and upload interface
- **Deployments**: Deployment target configuration and management
- **Test Tools**: Development utilities
- **Generate Profile**: Profile generation interface

---

## Features (In Progress)

- [ ] World Setup UI - Upload existing world ZIPs or generate new worlds through UI (MVP gap)
- [ ] Visual Configuration Forms - Ongoing form-based editing for `server.properties` and `paper-global.yml` in Project Detail page (MVP gap)
- [ ] Diff & History UI - View GitHub commit history and build diffs in UI (MVP gap)

### Detailed In-Progress Features

#### World Setup UI
- **Status**: MVP gap - listed as step 2 in project creation flow
- **Current state**: World configuration exists in profiles, but no UI for upload/generation
- **Required work**: Upload interface, world generation form, world management UI
- **See**: `tasks/enhancements/world-setup-ui.md`

#### Visual Configuration Forms
- **Status**: MVP gap - listed as main feature and step 4 in project creation flow
- **Current state**: One-time profile generation exists via `GenerateProfile` page
- **Required work**: Ongoing form-based editing in Project Detail page, real-time preview, profile integration
- **See**: `tasks/enhancements/visual-config-forms.md`

#### Diff & History UI
- **Status**: MVP gap - listed as main feature in spec
- **Current state**: Builds commit to GitHub, but no UI to view history or diffs
- **Required work**: Commit history view, build comparison, manifest diff display, file diff view
- **See**: `tasks/enhancements/diff-history-ui.md`

---

## Enhancements

### High Priority Enhancements (MVP Gaps)

- [ ] **World Setup UI** - Upload existing world ZIPs or generate new worlds through UI
  - **Priority**: High (MVP gap)
  - **Status**: Planned
  - **Estimate**: 2-3 days (Medium complexity)
  - **See**: `tasks/enhancements/world-setup-ui.md`

- [ ] **Visual Configuration Forms** - Ongoing form-based editing for `server.properties` and `paper-global.yml`
  - **Priority**: High (MVP gap)
  - **Status**: Planned
  - **Estimate**: 2-3 days (Medium complexity)
  - **See**: `tasks/enhancements/visual-config-forms.md`

- [ ] **Diff & History UI** - View GitHub commit history and build diffs
  - **Priority**: Medium (MVP gap)
  - **Status**: Planned
  - **Estimate**: 3-5 days (Medium-High complexity)
  - **See**: `tasks/enhancements/diff-history-ui.md`

### Medium Priority Enhancements

- [ ] **Overlays System** - Complete path-based override system for environment variations (dev/live)
  - **Status**: Partially implemented (files exist, arrays merge, but path-based overrides pending)
  - **Estimate**: 2-3 days (Medium complexity)
  - **See**: `tasks/enhancements/overlays-spec.md`

- [ ] **GitHub Pending Commits Queue** - Local queue system for failed GitHub commits with automatic retry
  - **Status**: Planned
  - **Estimate**: 2-3 days (Medium complexity)
  - **See**: `tasks/enhancements/github-pending-commits.md`

### Low Priority Enhancements

- [ ] **Plugin Lockfile Generation** - Record exact resolved plugin versions, URLs, and checksums
  - **Status**: Planned
  - **Estimate**: 1 day (Low complexity)
  - **See**: `tasks/enhancements/plugin-lockfile.md`

- [ ] **GitHub Conflict Resolution** - Auto-handle push conflicts with fetch/rebase
  - **Status**: Planned
  - **Estimate**: 3-4 days (Medium-High complexity)
  - **See**: `tasks/enhancements/github-conflict-resolution.md`

- [ ] **Deterministic Config Hashing** - Normalize config files for consistent hashes across platforms
  - **Status**: Planned
  - **Estimate**: 1 day (Low complexity)
  - **See**: `tasks/enhancements/deterministic-config-hashing.md`

- [ ] **Deterministic Folder Hashing** - Sort file paths deterministically for consistent folder hashes
  - **Status**: Planned
  - **Estimate**: 1-2 days (Low-Medium complexity)
  - **See**: `tasks/enhancements/deterministic-folder-hashing.md`

---

## Outstanding Tasks

### High Priority (MVP Gaps)

- [ ] World Setup UI - Upload/generate worlds through UI
- [ ] Visual Configuration Forms - Ongoing form-based editing for server configs

### Medium Priority

- [ ] Diff & History UI - View commit history and build diffs
- [ ] Overlays System - Complete path-based override implementation
- [ ] GitHub Pending Commits Queue - Local queue with automatic retry

### Low Priority / Future Extensions

- [ ] Plugin Registry Auto-Update - Automatic checking for plugin updates, update notifications
- [ ] Additional Server Types - Fabric loader support, Forge loader support (currently supports Paper only)
- [ ] Webhooks & Notifications - Webhooks for "build succeeded" notifications, integration with external services
- [ ] Shared Presets - Pre-configured server templates (e.g., "Exploration Server", "Creative Hub")
- [ ] Team Collaboration - Multi-user support, role-based access control, team project sharing

---

## Project Status

**Overall Status**: Active Development  
**Completion**: ~85% (MVP core complete, 3 MVP gaps remaining)  
**Last Major Update**: January 2026

### Metrics

- **Completed Features**: 11 major feature areas (including Electron App Conversion)
- **In Progress Features**: 3 MVP gap features
- **High Priority Enhancements (MVP Gaps)**: 3
- **Medium Priority Enhancements**: 2
- **Low Priority Enhancements**: 4
- **Low Priority / Future Extensions**: 5

---

## Next Steps

### Immediate (Next 1-2 weeks)

1. World Setup UI - Implement upload and generation interfaces
2. Visual Configuration Forms - Add ongoing form-based editing to Project Detail page

### Short-term (Next 1-3 months)

1. Diff & History UI - Commit history and build diff viewing
2. Overlays System - Complete path-based override implementation
3. GitHub Pending Commits Queue - Local queue with automatic retry

### Long-term (3+ months)

1. Plugin registry auto-update system
2. Additional server type support (Fabric, Forge)
3. Webhooks and notifications
4. Shared presets system
5. Team collaboration features

---

## Notes

### Key Files & Directories

#### Backend Routes
- `backend/src/routes/auth.ts` - GitHub OAuth authentication
- `backend/src/routes/projects.ts` - Project CRUD operations
- `backend/src/routes/plugins.ts` - Plugin library management
- `backend/src/routes/builds.ts` - Build queue and artifacts
- `backend/src/routes/runs.ts` - Local run management
- `backend/src/routes/deployments.ts` - Deployment targets
- `backend/src/routes/github.ts` - GitHub API integration

#### Frontend Pages
- `frontend/src/pages/Dashboard.tsx` - Main dashboard
- `frontend/src/pages/Projects.tsx` - Project list
- `frontend/src/pages/ProjectDetail.tsx` - Project detail view
- `frontend/src/pages/PluginLibrary.tsx` - Plugin management
- `frontend/src/pages/Deployments.tsx` - Deployment configuration
- `frontend/src/pages/GenerateProfile.tsx` - Profile generation

#### Storage
- `backend/data/projects.json` - Project metadata
- `backend/data/plugins.json` - Plugin library
- `backend/data/builds/builds.json` - Build queue
- `backend/data/runs/runs.json` - Run history
- `backend/data/deployments.json` - Deployment targets

#### Specifications
- `tasks/completed/MC_Server_Manager_Spec.md` - Main product specification (v1.0)
- `tasks/completed/clarifications.md` - Implementation details and decisions
- `tasks/completed/local-run-improvements.md` - Completed local run enhancements
- `tasks/completed/manage-plugin-config-paths.md` - Completed config path management
- `tasks/completed/ui-ux-overhaul.md` - Completed UI overhaul documentation
- `tasks/enhancements/README.md` - Planned enhancements and MVP gaps

### Architecture Decisions

- **File-based storage**: Using JSON files for simplicity and version control friendliness
- **Docker for local runs**: Leveraging `itzg/minecraft-server` container for consistent server execution
- **GitHub integration**: Each server project is a self-contained GitHub repository for versioning and reproducibility
- **SSE for logs**: Server-Sent Events provide real-time log streaming without WebSocket complexity
