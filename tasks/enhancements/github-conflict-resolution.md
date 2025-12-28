# GitHub Conflict Resolution

## Overview

Automatically handle push conflicts when committing to GitHub repositories. When a push fails due to remote changes, automatically fetch, rebase, and retry the commit.

## Current State

- Commits are pushed directly to GitHub
- If remote branch has moved ahead, commit fails
- **No conflict resolution** - user must manually resolve conflicts

## Enhancement

### Auto-Fetch & Rebase

1. **Conflict Detection:**
   - Detect 409 Conflict or "reference does not exist" errors
   - Check if remote branch has new commits

2. **Automatic Resolution:**
   ```
   On conflict:
   1. Fetch latest from remote branch
   2. Rebase local commit on top of remote
   3. Retry push
   4. If rebase conflicts, create fallback PR branch
   ```

3. **Fallback Strategy:**
   - If automatic rebase fails (merge conflicts):
     - Create branch: `mc-manager-<buildId>-<timestamp>`
     - Push commit to branch
     - Create PR with message explaining the conflict
     - Notify user in UI

4. **Implementation Details:**
   - Use Git operations via GitHub API or local git CLI
   - Handle file-level conflicts gracefully
   - Preserve commit message and metadata

## Implementation

1. **Conflict Handler:**
   - Extend `commitFiles` in `githubClient.ts`
   - Add conflict detection and resolution logic
   - Use GitHub API for fetch/merge operations

2. **Rebase Logic:**
   - Fetch latest tree from remote
   - Merge local changes with remote changes
   - Resolve simple conflicts automatically (e.g., different files)
   - Handle complex conflicts with fallback

3. **UI Feedback:**
   - Show conflict resolution status
   - Link to created PR if fallback used
   - Option to manually resolve if needed

## Benefits

- **Automation:** Reduces manual intervention for common conflicts
- **Reliability:** Handles concurrent edits gracefully
- **User experience:** Seamless operation in most cases

## Edge Cases

- **Complex merge conflicts:** Fall back to PR creation
- **Deleted files:** Handle gracefully
- **Permission issues:** Fail with clear error message
- **Large conflicts:** May need manual resolution

## Priority

**Low** - Edge case that doesn't happen often. Manual resolution is acceptable for MVP. Most conflicts are simple (different files changed) and could be auto-resolved.

