# Future Enhancements

This directory contains specifications for planned enhancements that are not part of the MVP scope but would improve the system's functionality, reliability, and user experience.

## Enhancement Specs

### 1. [Plugin Lockfile Generation](plugin-lockfile.md)
Generate `plugins/lock.yml` files that record exact resolved plugin versions, URLs, and checksums for reproducibility.

**Priority:** Low  
**Status:** Planned

### 2. [GitHub Pending Commits Queue](github-pending-commits.md)
Implement a local queue system for failed GitHub commits, automatically retrying when connectivity is restored.

**Priority:** Medium  
**Status:** Planned

### 3. [GitHub Conflict Resolution](github-conflict-resolution.md)
Automatically handle push conflicts by fetching, rebasing, and retrying commits. Fallback to PR creation for complex conflicts.

**Priority:** Low  
**Status:** Planned

### 4. [Deterministic Config Hashing](deterministic-config-hashing.md)
Normalize config files to UTF-8 + LF line endings before hashing to ensure consistent checksums across platforms.

**Priority:** Low  
**Status:** Planned

### 5. [Deterministic Folder Hashing](deterministic-folder-hashing.md)
Sort file paths deterministically when computing folder hashes (e.g., for datapacks) to ensure consistency across filesystems.

**Priority:** Low  
**Status:** Planned

### 6. [Overlays Specification](overlays-spec.md)
Complete implementation of overlay override system. Currently overlay files are read and plugin/config arrays are merged, but path-based overrides are not yet applied to config files.

**Priority:** Medium  
**Status:** Partially Implemented

## Notes

- All enhancements are optional and not required for MVP functionality
- Current implementation works without these features
- Enhancements can be implemented incrementally based on priority and user needs

