# MC Server Manager

Monorepo for the Minecraft Server Manager MVP.  
Includes a React frontend and Node/Express backend plus reusable project templates.

## Getting Started

Install dependencies for each workspace (npm manages this automatically when you run commands from the root).

```bash
npm install --workspaces

npm run dev:frontend
npm run dev:backend
```

## Environment

Create a `.env` file in the repo root to configure GitHub OAuth (dev-only defaults shown in `.env.example`).

Required keys:

- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`
- `AUTH_CALLBACK_URL` (usually `http://localhost:4000/api/auth/github/callback`)
- `SESSION_SECRET`
- `APP_BASE_URL` (frontend origin, e.g. `http://localhost:5173`)
- Optional: `GITHUB_SCOPE` (defaults to `repo read:user`)

Live server remote control (same pattern for each server; prefix `TELEDOSI_` or `CHARIDH_`):

- `{PREFIX}_SSH_HOST` / `{PREFIX}_SSH_USER` and either `{PREFIX}_SSH_PASSWORD` or `{PREFIX}_SSH_PRIVATE_KEY` / `{PREFIX}_SSH_PRIVATE_KEY_PATH` (+ optional `{PREFIX}_SSH_PASSPHRASE`)
- `{PREFIX}_SYSTEMD_UNIT` — optional; defaults to `minecraft-<serverId>` (e.g. `minecraft-teledosi`, `minecraft-charidh`)
- `{PREFIX}_RCON_WRAPPER_BIN` — optional; defaults to `<serverId>-rcon` (e.g. `teledosi-rcon`, `charidh-rcon`), executed on the VPS over SSH
- `{PREFIX}_SFTP_REMOTE_ROOT` — absolute path on the VPS for the file browser / Upload matching host
- Optional: `{PREFIX}_SFTP_PASSWORD` (falls back to `{PREFIX}_SSH_PASSWORD`)
- Optional: `{PREFIX}_SSH_PORT` (default `22`), `{PREFIX}_USE_SUDO` (default on), `{PREFIX}_LOGS_MAX_LINES`, `{PREFIX}_RCON_TIMEOUT_MS`, `{PREFIX}_FILES_MAX_BYTES`

Place `.env` next to the backend (`backend/.env`) when running the API from that folder. Command transport uses SSH to run a VPS-local wrapper so RCON can stay on the VPS.

**Upload:** When a project’s SFTP host, username, and port match a configured live server, the Upload page can use the backend `{PREFIX}_SFTP_PASSWORD` or `{PREFIX}_SSH_PASSWORD` as the default SFTP password.

**Adding another live server:** Add `{PREFIX}_*` env vars, append one entry to `liveServers` in `backend/src/config.ts`, and one entry to `frontend/src/lib/liveServers.ts`.

**Projects:** Renaming “Charidh Live” → “Charidh old-Live” and creating a new “Charidh Live” project for the new VPS is done in the app (Projects → project settings); not via git/code.

## Structure

- `frontend/` – Vite + React TypeScript UI scaffold.
- `backend/` – Express-based API with TypeScript build pipeline.
- `templates/server/` – Seed content for new server project repos.
- `docs/` – Additional design notes.
- `spec/` – Product & implementation specification.

## Templates

The `templates/server` directory mirrors the expected layout for generated Minecraft projects (profiles, overlays, plugin registry, and asset buckets). Update it as feature requirements evolve.

