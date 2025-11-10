## Local Run Iteration Enhancements

### Goal
Improve the existing Docker-based local run workflow so developers can iterate on a project world and configuration over multiple sessions without losing progress while still benefiting from the production-like container environment.

### Background
- Current runs extract the latest build artifact into a temporary workspace under `data/runs/workspaces/<runId>` and mount that directory into the `itzg/minecraft-server` container.
- Each run uses a fresh `runId`, so the workspace is re-created every time. All world progress and config edits made in the container are lost immediately after the run completes.
- The Docker container is launched detached; only stdout/stderr are tailed. There is no interactive console or command channel, so developers cannot issue commands (e.g., `/op`, `/reload`, `/stop`) or trigger hot-reloads during a session.

### Requirements
1. **Persistent Project Workspace**
   - Reuse a project-scoped working directory, e.g. `data/runs/workspaces/<projectId>`, across runs.
   - On first run (or explicit reset), populate the workspace from the latest build artifact. Subsequent runs should reuse the existing files, only updating files that changed in the artifact.
   - Preserve world data, plugin uploads, and edited config files between runs.
   - Provide a UI/API action to reset the workspace to the latest build artifact when needed.

2. **Interactive Console Access**
   - Maintain the container running in the background but expose a command channel.
   - Support sending console commands from the UI (e.g., via new API endpoint invoking `docker exec <container> rcon-cli` or attaching to stdin).
   - Stream console output back to the UI in near real time (extend existing SSE/WS log streaming to include command responses).

3. **Ergonomics & Safety**
   - Ensure the workspace location is clearly communicated and easy to back up.
   - Handle concurrent run requests: block new runs if one is already active for the project, or reuse the running container.
   - Provide clear indicators in the UI when the workspace has un-synced changes (optional stretch).
   - Allow manual stop/reset commands to terminate the container and optionally delete the workspace.

### Non-Goals / Notes
- Do not replace Docker with bare-metal execution; continue leveraging `itzg/minecraft-server`.
- No automatic synchronization back into Git; persistence is local-only.
- Initial implementation can target Windows/macOS/Linux uniformly since everything is Docker-based.


