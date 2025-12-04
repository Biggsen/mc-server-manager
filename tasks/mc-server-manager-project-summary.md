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
  "lastUpdated": "2025-11-14",
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
- `docs/` – Additional design notes
- `spec/` – Product & implementation specification

---

## Current Focus

Currently focused on **Local Run Improvements** and **Plugin Config Path Management**. These are high-priority enhancements that will improve the developer experience when testing servers locally and managing plugin configurations.

---

## Features (Done)

- [x] Project Management - Create new server projects with GitHub repository integration, import existing projects, manage project settings and metadata, GitHub OAuth authentication
- [x] Plugin Library - Upload and manage plugin JARs, version tracking, plugin registry with caching system, plugin metadata storage
- [x] Asset Management - Upload configuration files, datapacks, and world files with file organization and tracking
- [x] Build System - Generate server packages (ZIP + manifest), plugin version resolution, plugin JAR downloading and caching, build queue management, artifact storage and retrieval
- [x] Local Runs - Docker-based server execution, real-time log streaming via Server-Sent Events (SSE), run history tracking, run status management (running, succeeded, failed, stopped)
- [x] Deployments - Deploy to local folders and remote hosts via SFTP, deployment target management, build-to-deployment workflow
- [x] UI/UX System - Modern, cohesive interface with design tokens, component system (Button, Card, Badge, Tabs, Table, Toast, Skeleton), layout primitives (AppShell, MainCanvas, ContentSection), async action handling with loading states, toast notifications, responsive design (1280px+ desktop, tablet support)
- [x] UI/UX Overhaul - Complete redesign per `spec/completed/ui-ux-overhaul.md`
- [x] Design Token System - Comprehensive design system with component library

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
- Docker container integration
- Real-time log streaming via SSE
- Run history tracking
- Status management (running, succeeded, failed, stopped)

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

- [ ] Interactive Console Access - Basic console command sending exists but needs enhancement for full interactivity
- [ ] Persistent Project Workspaces - Runs currently use temporary workspaces, need project-scoped persistence
- [ ] Enhanced Config Management - Upload works, but lacks plugin association and guided flows

### Detailed In-Progress Features

#### Interactive Console Access
- **Current status**: Basic console command sending implemented
- **Remaining work**: Full interactivity with command channel, real-time response streaming, enhanced SSE/WS log streaming
- **Estimated completion**: Part of Local Run Improvements enhancement

#### Persistent Project Workspaces
- **Current status**: Runs extract build artifacts into temporary workspaces (`data/runs/workspaces/<runId>`)
- **Remaining work**: Implement project-scoped working directories, preserve world data and config edits between runs
- **Estimated completion**: Part of Local Run Improvements enhancement

#### Enhanced Config Management
- **Current status**: Config file uploads work but depend on ad-hoc relative paths
- **Remaining work**: Plugin association, config path definitions, guided upload flows
- **Estimated completion**: Part of Plugin Config Path Management enhancement

---

## Enhancements

- [ ] Local Run Improvements - Persistent project workspaces, interactive console access, ergonomics and safety improvements
- [ ] Plugin Config Path Management - Plugin library extensions, project-level config mappings, API endpoints, UI enhancements, backend integration

### High Priority Enhancements

#### Local Run Improvements
**Source**: `spec/local-run-improvements.md`

**Current State**: 
- Runs extract build artifacts into temporary workspaces (`data/runs/workspaces/<runId>`)
- Each run creates a fresh workspace, losing all world progress and config edits
- Docker container runs detached with stdout/stderr tailing only
- Basic console command sending exists but needs enhancement

**Required Enhancements**:
- **Persistent Project Workspace**
  - Reuse project-scoped working directory (`data/runs/workspaces/<projectId>`) across runs
  - On first run, populate from latest build artifact
  - Subsequent runs reuse existing files, only updating changed files
  - Preserve world data, plugin uploads, and edited config files between runs
  - Provide UI/API action to reset workspace to latest build artifact

- **Interactive Console Access**
  - Maintain container running in background with command channel
  - Support sending console commands from UI (e.g., `/op`, `/reload`, `/stop`)
  - Stream console output back to UI in near real-time
  - Extend existing SSE/WS log streaming to include command responses

- **Ergonomics & Safety**
  - Clearly communicate workspace location for easy backup
  - Handle concurrent run requests (block new runs if one active, or reuse running container)
  - Provide UI indicators when workspace has un-synced changes
  - Allow manual stop/reset commands to terminate container and optionally delete workspace

#### Plugin Config Path Management
**Source**: `spec/manage-plugin-config-paths.md`

**Current State**: 
- Config file uploads depend on ad-hoc relative paths
- Cannot tell which configs belong to which plugin
- Cannot detect missing required configs
- No guided flow for config uploads

**Required Enhancements**:
- **Plugin Library Extensions**
  - Extend `StoredPluginRecord` with optional `configDefinitions` array
  - Define canonical config paths per plugin (required/optional/generated)
  - Add labels, descriptions, and tags for config definitions

- **Project-Level Config Mappings**
  - Extend `ProjectPlugin` with optional `configMappings`
  - Allow project-specific path overrides
  - Support requirement overrides and notes

- **API Endpoints**
  - `GET /projects/:id/plugins/:pluginId/configs` - return definitions with status
  - `PUT /projects/:id/plugins/:pluginId/configs` - update config mappings
  - `PUT /plugins/library/:id/:version/configs` - update plugin config definitions

- **UI Enhancements**
  - "Manage config paths" modal in Plugin Library
  - "Manage config paths" action per plugin in Project Detail
  - Surface missing configs with upload links
  - Group configs by plugin in Config Files tab
  - Pre-fill paths when uploading configs based on definitions

- **Backend Integration**
  - Update `scanProjectAssets` to associate configs with definitions
  - Match uploaded configs to definitions by path
  - Persist `pluginId` and `definitionId` on stored config entries

### Medium Priority Enhancements

- [ ] Visual Configuration Forms - Form-based editing for `server.properties` and `paper-global.yml`, MOTD, player limits, view/simulation distance configuration, settings validation and preview
- [ ] Overlays System - Environment variations (dev/live) without duplicating config files, overlay management UI, overlay application during builds (templates exist but UI integration needed)
- [ ] World Generation - UI for generating new worlds, world name, seed (text or numeric), world type configuration, structures on/off toggle, world generation integration with build system
- [ ] Enhanced GitHub Integration - View commit history in UI, diff viewing between builds via GitHub commits, manifest diff comparison, enhanced commit messages and metadata (basic integration exists)

---

## Outstanding Tasks

### High Priority

- [ ] Local Run Improvements - Implement persistent project workspaces and interactive console access
- [ ] Plugin Config Path Management - Add plugin config path definitions and management UI

### Medium Priority

- [ ] Visual Configuration Forms - Form-based editing for server configuration files
- [ ] Overlays System - UI integration for environment variations
- [ ] World Generation - UI for generating new worlds
- [ ] Enhanced GitHub Integration - Commit history and diff viewing in UI

### Low Priority / Future Extensions

- [ ] Plugin Registry Auto-Update - Automatic checking for plugin updates, update notifications, one-click update workflow
- [ ] Additional Server Types - Fabric loader support, Forge loader support (currently supports Paper only)
- [ ] Webhooks & Notifications - Webhooks for "build succeeded" notifications, integration with external services, email/Slack notifications
- [ ] Shared Presets - Pre-configured server templates (e.g., "Exploration Server", "Creative Hub"), preset library, one-click preset application
- [ ] Team Collaboration - Multi-user support, role-based access control, team project sharing, collaboration features

---

## Project Status

**Overall Status**: Active Development  
**Completion**: ~75%  
**Last Major Update**: November 2025

### Metrics

- **Completed Features**: 8 major feature areas
- **In Progress Features**: 3 features
- **High Priority Enhancements**: 2
- **Medium Priority Enhancements**: 4
- **Future Extensions**: 5

---

## Next Steps

### Immediate (Next 1-2 weeks)

1. Implement persistent project workspaces for local runs
2. Add plugin config path definitions and management UI
3. Enhance console interactivity and command support

### Short-term (Next 1-3 months)

1. Visual configuration forms for server.properties and paper-global.yml
2. Overlays system UI integration
3. World generation UI
4. Enhanced GitHub integration (commit history and diff viewing)

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
- `spec/MC_Server_Manager_Spec.md` - Main product specification
- `spec/local-run-improvements.md` - Local run enhancement plan
- `spec/manage-plugin-config-paths.md` - Config path management design
- `spec/completed/ui-ux-overhaul.md` - Completed UI overhaul documentation

### Architecture Decisions

- **File-based storage**: Using JSON files for simplicity and version control friendliness
- **Docker for local runs**: Leveraging `itzg/minecraft-server` container for consistent server execution
- **GitHub integration**: Each server project is a self-contained GitHub repository for versioning and reproducibility
- **SSE for logs**: Server-Sent Events provide real-time log streaming without WebSocket complexity
