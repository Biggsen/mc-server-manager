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

## Structure

- `frontend/` – Vite + React TypeScript UI scaffold.
- `backend/` – Express-based API with TypeScript build pipeline.
- `templates/server/` – Seed content for new server project repos.
- `docs/` – Additional design notes.
- `spec/` – Product & implementation specification.

## Templates

The `templates/server` directory mirrors the expected layout for generated Minecraft projects (profiles, overlays, plugin registry, and asset buckets). Update it as feature requirements evolve.

