# Diff & History UI

## Overview

Add UI to view GitHub commit history and diffs between builds. The spec mentions "View what changed between builds via GitHub commits and manifests" as a main feature, but currently there's no UI for this.

## Current State

- Builds commit to GitHub with manifest and artifacts
- Commits include build metadata in commit messages
- Manifests track build IDs and checksums
- **No UI to view commit history or diffs**
- Users must use GitHub directly or git commands to see changes

## Enhancement

### Commit History View

1. **History Interface:**
   - Add "History" tab in Project Detail page
   - List of commits related to builds
   - Show commit message, author, date
   - Link to GitHub commit
   - Filter by build commits vs other commits

2. **Build Timeline:**
   - Show builds in chronological order
   - Link builds to their GitHub commits
   - Show build status (succeeded, failed)
   - Show build artifacts (ZIP, manifest)

### Diff View

1. **Build Comparison:**
   - Select two builds to compare
   - Show diff of manifest files
   - Highlight changes in:
     - Plugin versions
     - Config file checksums
     - World settings
     - Minecraft version
     - Other manifest fields

2. **File Diff View:**
   - Compare config files between builds
   - Show line-by-line diffs
   - Highlight added/removed/changed lines
   - Support for YAML, properties, JSON formats

3. **GitHub Integration:**
   - Fetch commit diffs via GitHub API
   - Show file changes between commits
   - Link to GitHub's diff view
   - Handle large diffs gracefully

### Manifest Diff

1. **Manifest Comparison:**
   - Side-by-side or unified diff view
   - Highlight changed fields
   - Show plugin version changes
   - Show config checksum changes
   - Show artifact size/checksum changes

## Implementation

1. **Backend Routes:**
   - `GET /projects/:id/history` - get commit history
   - `GET /projects/:id/builds/:buildId1/diff/:buildId2` - compare two builds
   - `GET /projects/:id/commits/:sha/diff` - get GitHub commit diff
   - Use GitHub API to fetch commits and diffs

2. **GitHub Service:**
   - `services/githubHistory.ts` - fetch commit history
   - `services/buildDiff.ts` - compare builds and manifests
   - Cache commit data to reduce API calls
   - Handle rate limits gracefully

3. **Frontend Components:**
   - `HistoryView.tsx` - commit history list
   - `BuildDiffView.tsx` - build comparison interface
   - `ManifestDiff.tsx` - manifest diff display
   - `FileDiff.tsx` - file diff display (syntax highlighting)
   - Add to Project Detail page (new "History" tab)

4. **Diff Rendering:**
   - Use library like `react-diff-view` or `diff-match-patch`
   - Syntax highlighting for YAML, properties, JSON
   - Collapsible sections for large diffs
   - Copy diff to clipboard

## Benefits

- **Transparency:** See what changed between builds
- **Debugging:** Identify what caused issues between builds
- **Audit trail:** Track all changes to server configuration
- **User experience:** No need to leave UI to view GitHub

## Priority

**Medium** - Listed as a main feature in the spec, but MVP can function without it (users can use GitHub directly). Improves user experience and completes the "version control" workflow.

