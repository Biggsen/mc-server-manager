## Local Run Iteration Enhancements

### Goal
Improve the existing Docker-based local run workflow so developers can iterate on a project world and configuration over multiple sessions without losing progress while still benefiting from the production-like container environment.

### Background (Original State - Now Implemented)
- Previously, runs extracted the latest build artifact into temporary workspaces under `data/runs/workspaces/<runId>` and mounted that directory into the `itzg/minecraft-server` container.
- Each run used a fresh `runId`, so workspaces were re-created every time, causing all world progress and config edits to be lost after run completion.
- The Docker container was launched detached; only stdout/stderr were tailed with no interactive console or command channel.

### Implementation Status: ✅ Complete

All requirements have been implemented. The current system provides:

- **Persistent project-scoped workspaces** at `data/runs/workspaces/<projectId>`
- **Incremental artifact synchronization** that preserves local changes
- **Interactive console access** via stdin piping
- **Concurrent run protection** and workspace reset capabilities

### Requirements (All Implemented)

1. **Persistent Project Workspace** ✅
   - ✅ Reuses a project-scoped working directory at `data/runs/workspaces/<projectId>` across runs
   - ✅ On first run (or explicit reset), populates the workspace from the latest build artifact
   - ✅ Subsequent runs reuse existing files, only updating files that changed in the artifact (via hash-based comparison)
   - ✅ Preserves world data, plugin uploads, and edited config files between runs (tracks "dirty" paths)
   - ✅ UI/API action to reset workspace: `POST /api/projects/:id/run/reset-workspace`
   - **Implementation details:**
     - Workspace state stored in `.workspace-state.json` with baseline hashes and dirty path tracking
     - `syncWorkspaceWithArtifact()` handles intelligent file updates based on hash comparison
     - Files that differ from artifact but weren't previously tracked are marked dirty and preserved

2. **Interactive Console Access** ✅
   - ✅ Container runs with interactive mode (`docker run -i`) to maintain stdin channel
   - ✅ Command channel exposed via stdin piping (chosen over RCON for simplicity)
   - ✅ API endpoint for sending commands: `POST /api/runs/:id/command`
   - ✅ Console output streamed via existing SSE log streaming
   - ✅ Console availability tracked via `consoleAvailable` flag on RunJob
   - **Implementation details:**
     - Uses Docker stdin channel (`stdinStreams` map) rather than RCON
     - Commands sent as newline-terminated strings to container stdin
     - Command echo logged as system message with `> ` prefix

3. **Ergonomics & Safety** ✅
   - ✅ Workspace path returned in API responses (could be more prominently displayed in UI)
   - ✅ Concurrent run handling: blocks new runs if one is already active for the project
   - ⚠️ UI indicators for un-synced workspace changes: workspace status tracked but not prominently displayed (optional stretch goal)
   - ✅ Manual stop command: `POST /api/runs/:id/stop`
   - ✅ Reset workspace command (requires no active runs)
   - **Implementation details:**
     - `enqueueRun()` checks for existing active runs before creating new job
     - Reset validates no active runs before deletion
     - Container uses `--rm` flag (auto-removes on exit, but persists while running)

### Implementation Notes

#### Technical Decisions
- **Command Channel:** Uses Docker stdin piping instead of RCON for simplicity and immediate availability without server configuration
- **Container Lifecycle:** Uses `docker run -i --rm` - interactive mode enables stdin, `--rm` auto-cleans on exit but container persists while running
- **Concurrent Runs:** Chose blocking approach (reject new runs if active) rather than container reuse for safety and simplicity
- **Sync Strategy:** Hash-based file comparison (SHA-256) with dirty path tracking to preserve local modifications while allowing artifact updates

#### API Endpoints
- `POST /api/projects/:id/run` - Start new run (uses persistent workspace)
- `POST /api/runs/:id/stop` - Stop active run
- `POST /api/runs/:id/command` - Send console command to running container
- `POST /api/projects/:id/run/reset-workspace` - Reset workspace to latest artifact (requires no active runs)
- `GET /api/runs/stream` - SSE stream for run updates and logs

### Non-Goals (Maintained)
- Do not replace Docker with bare-metal execution; continue leveraging `itzg/minecraft-server`
- No automatic synchronization back into Git; persistence is local-only
- Cross-platform support via Docker (Windows/macOS/Linux)


