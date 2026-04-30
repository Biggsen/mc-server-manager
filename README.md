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

Teledosi remote control keys:

- `TELEDOSI_SSH_HOST` / `TELEDOSI_SSH_USER` and either `TELEDOSI_SSH_PASSWORD` or SSH private key vars
- `TELEDOSI_RCON_HOST` / `TELEDOSI_RCON_PASSWORD`
- Optional: `TELEDOSI_RCON_PORT` (default `25575`)
- Optional: `TELEDOSI_RCON_TIMEOUT_MS` (default `5000`, min `250`, max `30000`)
- Optional: `TELEDOSI_MCRCON_BIN` (default `mcrcon`, executed on the VPS over SSH)

Teledosi command transport uses SSH to run `mcrcon` on the VPS (Option B), so RCON can stay local
to the VPS and does not need to be publicly exposed.

## Structure

- `frontend/` – Vite + React TypeScript UI scaffold.
- `backend/` – Express-based API with TypeScript build pipeline.
- `templates/server/` – Seed content for new server project repos.
- `docs/` – Additional design notes.
- `spec/` – Product & implementation specification.

## Templates

The `templates/server` directory mirrors the expected layout for generated Minecraft projects (profiles, overlays, plugin registry, and asset buckets). Update it as feature requirements evolve.

