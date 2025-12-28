# Future Enhancements

This directory contains specifications for planned enhancements that are not part of the MVP scope but would improve the system's functionality, reliability, and user experience.

## Enhancement Specs

### MVP Gaps (High Priority)

These features are mentioned in the main spec but not yet implemented:

### 1. [World Setup UI](world-setup-ui.md)
Add UI for uploading existing world files or generating new worlds during project creation and editing.

**Priority:** High  
**Status:** Planned  
**MVP Gap:** Yes - listed as step 2 in project creation flow

### 2. [Visual Configuration Forms](visual-config-forms.md)
Add ongoing form-based editing for `server.properties` and `paper-global.yml` within projects.

**Priority:** High  
**Status:** Planned  
**MVP Gap:** Yes - listed as main feature and step 4 in project creation flow

### 3. [Diff & History UI](diff-history-ui.md)
Add UI to view GitHub commit history and diffs between builds.

**Priority:** Medium  
**Status:** Planned  
**MVP Gap:** Yes - listed as main feature in spec

### Other Enhancements

### 4. [Plugin Lockfile Generation](plugin-lockfile.md)
Generate `plugins/lock.yml` files that record exact resolved plugin versions, URLs, and checksums for reproducibility.

**Priority:** Low  
**Status:** Planned

### 5. [GitHub Pending Commits Queue](github-pending-commits.md)
Implement a local queue system for failed GitHub commits, automatically retrying when connectivity is restored.

**Priority:** Medium  
**Status:** Planned

### 6. [GitHub Conflict Resolution](github-conflict-resolution.md)
Automatically handle push conflicts by fetching, rebasing, and retrying commits. Fallback to PR creation for complex conflicts.

**Priority:** Low  
**Status:** Planned

### 7. [Deterministic Config Hashing](deterministic-config-hashing.md)
Normalize config files to UTF-8 + LF line endings before hashing to ensure consistent checksums across platforms.

**Priority:** Low  
**Status:** Planned

### 8. [Deterministic Folder Hashing](deterministic-folder-hashing.md)
Sort file paths deterministically when computing folder hashes (e.g., for datapacks) to ensure consistency across filesystems.

**Priority:** Low  
**Status:** Planned

### 9. [Overlays Specification](overlays-spec.md)
Complete implementation of overlay override system. Currently overlay files are read and plugin/config arrays are merged, but path-based overrides are not yet applied to config files.

**Priority:** Medium  
**Status:** Partially Implemented

## Notes

- **MVP Gaps** (items 1-3) are mentioned in the main spec and should be prioritized for MVP completion
- Other enhancements are optional and not required for MVP functionality
- Current implementation works without these features
- Enhancements can be implemented incrementally based on priority and user needs

