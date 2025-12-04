# MC Server Manager - Project Summary

## Overview

**MC Server Manager** is a UI-based tool for creating, configuring, and deploying fully-set-up Minecraft servers (specifically Paper). It replaces the usual manual setup steps (downloading JARs, adding plugins, editing configs, etc.) with a visual, GitHub-backed workflow.

Each server you make is a **self-contained project** stored in its own GitHub repository, making it versioned and reproducible.

### Core Philosophy
You don't "run" a server first — you **define** it. You configure everything through the UI (Minecraft version, plugins, datapacks, configs, world seed), then when ready, you build and test that definition locally or deploy it to a host.

---

## Architecture

### Tech Stack
- **Frontend**: React + Vite + TypeScript with Mantine UI components
- **Backend**: Node.js + Express + TypeScript
- **Storage**: File-based JSON storage for projects, builds, runs, deployments, and plugins
- **Authentication**: GitHub OAuth integration
- **Local Testing**: Docker-based runs using `itzg/minecraft-server` container

### Project Structure
- `frontend/` – React + Vite TypeScript UI
- `backend/` – Express-based API with TypeScript build pipeline
- `templates/server/` – Seed content for new server project repos
- `docs/` – Additional design notes
- `spec/` – Product & implementation specification

---

## Core Features Implemented

### ✅ Project Management
- Create new server projects with GitHub repository integration
- Import existing projects
- Manage project settings and metadata
- GitHub OAuth authentication

### ✅ Plugin Library
- Upload and manage plugin JARs
- Version tracking for plugins
- Plugin registry with caching system
- Plugin metadata storage

### ✅ Asset Management
- Upload configuration files
- Upload datapacks
- Upload world files
- File organization and tracking

### ✅ Build System
- Generate server packages (ZIP + manifest)
- Plugin version resolution
- Plugin JAR downloading and caching
- Build queue management
- Artifact storage and retrieval

### ✅ Local Runs
- Docker-based server execution
- Real-time log streaming via Server-Sent Events (SSE)
- Run history tracking
- Basic console command support (partial implementation)
- Run status management (running, succeeded, failed, stopped)

### ✅ Deployments
- Deploy to local folders
- Deploy to remote hosts via SFTP
- Deployment target management
- Build-to-deployment workflow

### ✅ UI/UX System
- Modern, cohesive interface with design tokens
- Component system (Button, Card, Badge, Tabs, Table, Toast, Skeleton)
- Layout primitives (AppShell, MainCanvas, ContentSection)
- Async action handling with loading states
- Toast notifications
- Responsive design (1280px+ desktop, tablet support)

### Key UI Pages
- **Dashboard**: Project overview, activity feed, quick actions
- **Projects**: List view with filtering and search
- **Project Detail**: Multi-tab interface (Overview, Assets, Builds, Runs, Repository, Settings)
- **Plugin Library**: Plugin management and upload interface
- **Deployments**: Deployment target configuration and management
- **Test Tools**: Development utilities
- **Generate Profile**: Profile generation interface

---

## Outstanding Tasks

### 🔴 High Priority

#### 1. Local Run Improvements
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

#### 2. Plugin Config Path Management
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

### 🟡 Medium Priority

#### 3. Visual Configuration Forms
**Status**: Mentioned in spec but implementation status unclear

- Form-based editing for `server.properties`
- Form-based editing for `paper-global.yml`
- MOTD, player limits, view/simulation distance configuration
- Settings validation and preview

#### 4. Overlays System
**Status**: Templates exist but UI integration needed

- Environment variations (dev/live) without duplicating config files
- Overlay management UI
- Overlay application during builds

#### 5. World Generation
**Status**: Not implemented

- UI for generating new worlds
- World name, seed (text or numeric), world type configuration
- Structures on/off toggle
- World generation integration with build system

#### 6. Enhanced GitHub Integration
**Status**: Basic integration exists

- View commit history in UI
- Diff viewing between builds via GitHub commits
- Manifest diff comparison
- Enhanced commit messages and metadata

### 🟢 Low Priority / Future Extensions

#### 7. Plugin Registry Auto-Update
- Automatic checking for plugin updates
- Update notifications
- One-click update workflow

#### 8. Additional Server Types
- Fabric loader support
- Forge loader support
- Currently supports Paper only

#### 9. Webhooks & Notifications
- Webhooks for "build succeeded" notifications
- Integration with external services
- Email/Slack notifications

#### 10. Shared Presets
- Pre-configured server templates (e.g., "Exploration Server", "Creative Hub")
- Preset library
- One-click preset application

#### 11. Team Collaboration
- Multi-user support
- Role-based access control
- Team project sharing
- Collaboration features

---

## Implementation Status Notes

### Completed Features
- ✅ UI/UX overhaul (per `spec/completed/ui-ux-overhaul.md`)
- ✅ Basic project CRUD operations
- ✅ Plugin library with upload and versioning
- ✅ Build system with artifact generation
- ✅ Local runs with Docker integration
- ✅ Deployment infrastructure (folder and SFTP)
- ✅ Design token system and component library
- ✅ Async action handling and toast notifications

### Partially Implemented
- 🔄 Console command sending (basic implementation exists, needs enhancement for full interactivity)
- 🔄 Workspace persistence (runs use temporary workspaces, need project-scoped persistence)
- 🔄 Config management (upload works, but lacks plugin association and guided flows)

### Not Implemented
- ❌ Persistent project workspaces for runs
- ❌ Interactive console with full command support
- ❌ Plugin config path definitions
- ❌ Visual configuration forms
- ❌ Overlays UI
- ❌ World generation UI
- ❌ Enhanced GitHub diff/history viewing

---

## Key Files & Directories

### Backend Routes
- `backend/src/routes/auth.ts` - GitHub OAuth authentication
- `backend/src/routes/projects.ts` - Project CRUD operations
- `backend/src/routes/plugins.ts` - Plugin library management
- `backend/src/routes/builds.ts` - Build queue and artifacts
- `backend/src/routes/runs.ts` - Local run management
- `backend/src/routes/deployments.ts` - Deployment targets
- `backend/src/routes/github.ts` - GitHub API integration

### Frontend Pages
- `frontend/src/pages/Dashboard.tsx` - Main dashboard
- `frontend/src/pages/Projects.tsx` - Project list
- `frontend/src/pages/ProjectDetail.tsx` - Project detail view
- `frontend/src/pages/PluginLibrary.tsx` - Plugin management
- `frontend/src/pages/Deployments.tsx` - Deployment configuration
- `frontend/src/pages/GenerateProfile.tsx` - Profile generation

### Storage
- `backend/data/projects.json` - Project metadata
- `backend/data/plugins.json` - Plugin library
- `backend/data/builds/builds.json` - Build queue
- `backend/data/runs/runs.json` - Run history
- `backend/data/deployments.json` - Deployment targets

### Specifications
- `spec/MC_Server_Manager_Spec.md` - Main product specification
- `spec/local-run-improvements.md` - Local run enhancement plan
- `spec/manage-plugin-config-paths.md` - Config path management design
- `spec/completed/ui-ux-overhaul.md` - Completed UI overhaul documentation

---

## Next Steps

1. **Immediate Priority**: Implement persistent project workspaces for local runs
2. **High Priority**: Add plugin config path definitions and management UI
3. **Medium Priority**: Enhance console interactivity and command support
4. **Future**: Visual config forms, overlays UI, world generation

---

*Last Updated: 2025-01-13*

