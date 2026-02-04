# Active Indicator: Backend Jobs

**Status:** Planned  
**Priority:** Medium  
**Estimate:** 4–6 hours (Low–Medium complexity)  
**Dependencies:** None

## Overview

Make the header's ActiveActionIndicator reflect long-running backend work (builds, runs) instead of only in-flight HTTP requests. Today the indicator shows "busy" only while an API call is in progress—e.g. "Triggering build" for the duration of the queue request—then reverts to "Idle" even though a build may still be running on the backend.

## Current State

- `ActiveActionIndicator` in the header uses `useActiveAsyncActions()` from `AsyncActionsContext`
- Only actions registered via `useAsyncAction` appear (register on start, complete when promise settles)
- Build queue: `triggerBuild()` returns as soon as the build is queued; the indicator goes idle while the build runs
- Run start: similar—the "start run" request completes quickly; the run continues
- Runs have SSE (`/api/runs/stream`) for real-time updates; builds have no stream, only `fetchBuilds()`
- Dashboard/Projects/ProjectDetail poll or subscribe to runs/builds, but that state is page-local, not fed to the header

## Goal

When a build is running or a run is active (pending/running/stopping), the header indicator should show a busy state and a meaningful label (e.g. "Building…", "Server running") so the user can see at a glance that something is happening in the background.

## Scope

### In scope

- Extend the indicator to display backend jobs (builds, runs) alongside existing request-based actions
- Runs: use existing SSE `/api/runs/stream` (no projectId = all runs) to detect active runs and feed them to the indicator
- Builds: poll `fetchBuilds()` periodically to detect builds with status `running` or `pending`, feed to indicator
- Labels: e.g. "Building…", "Server running (project-name)", "Stopping server…" depending on job type and status
- When multiple jobs exist, show the most recent/relevant one (same behavior as today for multiple actions)
- Indicator remains in header; existing blue/gray styling for busy/idle unchanged

### Out of scope

- Build streaming (SSE) on the backend—polling is acceptable for builds
- Deployments or other long-running jobs (can be added later)
- Changing how existing `useAsyncAction` request-based actions work

## Data Model

### Backend job keys

- `build:${buildId}` — for builds with status `running` or `pending`
- `run:${runId}` — for runs with status `pending`, `running`, or `stopping`

### Label mapping

| Type   | Status    | Label example                          |
|--------|-----------|----------------------------------------|
| Build  | running   | `Building…` or `Building (project-id)` |
| Build  | pending   | `Build queued…`                        |
| Run    | running   | `Server running (project-id)`          |
| Run    | pending   | `Starting server…`                     |
| Run    | stopping  | `Stopping server…`                     |

## Implementation

### 1. Extend AsyncActionsContext

Add support for backend jobs alongside request-based actions:

```ts
// asyncActionsContext.ts (extend existing)
registerBackendJob(key: string, label: string): void
completeBackendJob(key: string): void
```

- `key`: unique identifier (`build:${id}` or `run:${runId}`)
- `registerBackendJob`: add or update a backend job in the actions list (idempotent for same key)
- `completeBackendJob`: remove the job
- `ActiveActionIndicator` already reads `actions`; it will automatically show backend jobs once they are in the list
- Merged display: combine request-based and backend jobs; show latest by `startedAt` or insertion order

### 2. ActiveBackendJobsProvider

New provider (or logic inside `AsyncActionsProvider`) that:

- Subscribes to `/api/runs/stream` when the app loads (no `projectId` so it receives all run updates)
- On `run-update` events: if status is `pending`/`running`/`stopping`, call `registerBackendJob(\`run:${run.id}\`, label)`; otherwise `completeBackendJob(\`run:${run.id}\`)`
- Polls `fetchBuilds()` every 5 seconds (or configurable interval)
- For each build with status `running` or `pending`, call `registerBackendJob(\`build:${build.id}\`, label)`
- For builds that have finished (or are no longer in the response with active status), call `completeBackendJob(\`build:${build.id}\`)`
- Provider mounts inside `AsyncActionsProvider` so it can call `registerBackendJob` / `completeBackendJob`
- Unsubscribe / clear poll on unmount; handle auth—only run when user is authenticated

### 3. File structure

- `frontend/src/lib/asyncActionsContext.ts` — add `registerBackendJob`, `completeBackendJob` to context value
- `frontend/src/lib/asyncActions.tsx` — implement backend job state in provider
- `frontend/src/components/ActiveBackendJobsProvider.tsx` — or `hooks/useActiveBackendJobs.ts` — SSE subscription + build polling, calls into context
- `frontend/src/App.tsx` — render `ActiveBackendJobsProvider` inside `AsyncActionsProvider`, alongside existing app content

### 4. API usage

- `GET /api/runs/stream` — already exists; subscribe without `projectId` for global run updates
- `GET /api/builds` — already exists; returns `{ builds: BuildJob[] }`; include builds with `status: 'running' | 'pending'`

No new backend endpoints required.

## Edge Cases

- **User not authenticated:** Don't connect to runs stream or poll builds; indicator falls back to request-based actions only
- **Tab/route change:** SSE and poll should continue (provider is at app level) so indicator stays accurate when navigating
- **Multiple builds/runs:** Show one label (e.g. latest) with optional badge "+N" if multiple, same as current multi-action behavior
- **Build completes while polling:** Next poll finds build no longer `running`/`pending`; call `completeBackendJob` to remove from indicator
- **Run completes via SSE:** Event received; call `completeBackendJob` immediately
- **SSE connection drops:** Reconnection handled by browser/EventSource or implement reconnect logic; until then, build polling still surfaces active builds

## Success Criteria

- When a build is queued and running, the header shows "Building…" (or similar) instead of "Idle"
- When a run is started, the header shows "Server running…" (or similar) until the run stops
- When stopping a run, the header shows "Stopping server…" during the stopping phase
- Multiple concurrent jobs (e.g. build + run) appear in the indicator with appropriate count badge
- Existing request-based actions (trigger build, scan assets, sync, etc.) continue to appear during their in-flight period
- No new backend APIs; reuse existing runs stream and builds fetch
