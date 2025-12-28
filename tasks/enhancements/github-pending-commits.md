# GitHub Pending Commits Queue

## Overview

Implement a local queue system for GitHub commits that fail due to network issues, rate limits, or temporary GitHub outages. Commits are queued locally and automatically retried when connectivity is restored.

## Current State

- GitHub commits are attempted immediately during builds
- If commit fails, build may fail or commit is lost
- Basic retry logic exists for rate limits (via Octokit throttling)
- **No persistent queue** - failed commits are not saved for later retry

## Enhancement

### Local-First Mode

1. **Queue Structure:**
   ```
   data/
     pending-commits/
       <project-id>/
         <commit-id>.json
   ```

2. **Commit Queue Entry:**
   ```json
   {
     "id": "uuid",
     "projectId": "project-name",
     "createdAt": "2025-01-15T10:30:00Z",
     "retryCount": 0,
     "lastError": null,
     "files": {
       "path/to/file": "content or base64"
     },
     "message": "build: project-name (20250115-103000)",
     "branch": "main"
   }
   ```

3. **Behavior:**
   - On commit failure (network error, 5xx, rate limit), write to queue
   - Build continues successfully (commit is queued, not failed)
   - Background process periodically retries queued commits
   - UI shows pending commits count/status
   - Manual retry button for queued commits

4. **Retry Logic:**
   - Exponential backoff: 1min, 5min, 15min, 1hr
   - Max retries: 10 attempts
   - After max retries, mark as failed, notify user
   - On success, remove from queue

## Implementation

1. **Queue Service:**
   - `services/commitQueue.ts` - manage pending commits
   - Store queue entries as JSON files
   - Background worker to process queue

2. **Build Integration:**
   - Catch commit failures in `pushBuildToRepository`
   - Write to queue instead of failing
   - Log warning but continue build

3. **UI Integration:**
   - Show pending commits indicator
   - List of queued commits with retry status
   - Manual retry/clear actions

## Benefits

- **Resilience:** Builds succeed even if GitHub is temporarily unavailable
- **User experience:** No need to manually retry failed commits
- **Offline support:** Can queue commits when offline, push when online

## Priority

**Medium** - Improves reliability and user experience, but MVP can work without it (builds just fail if GitHub is down).

