# Deterministic Config File Hashing

## Overview

Normalize config files to UTF-8 encoding with LF line endings before computing SHA-256 checksums. This ensures consistent hashes across different operating systems and editors.

## Current State

- Config files are hashed using raw buffer content
- Line endings may vary (CRLF on Windows, LF on Unix)
- Encoding may not be explicitly normalized
- **Hashes may differ** on different platforms for the same logical content

## Enhancement

### Normalization Process

1. **Before Hashing:**
   ```
   For each text config file:
   1. Read file content
   2. Normalize encoding to UTF-8
   3. Normalize line endings to LF (\n)
   4. Compute SHA-256 hash
   ```

2. **Implementation:**
   - Add normalization function in `configUploads.ts` and `buildQueue.ts`
   - Apply before computing checksums
   - Preserve original file content (don't modify files on disk)

3. **File Types:**
   - Text configs: `.properties`, `.yml`, `.yaml`, `.json`, `.txt`, `.conf`
   - Binary files: Skip normalization (hash as-is)
   - Detect file type by extension or content

## Implementation

1. **Normalization Function:**
   ```typescript
   function normalizeForHashing(content: string): Buffer {
     // Ensure UTF-8 encoding
     const utf8 = Buffer.from(content, 'utf-8').toString('utf-8');
     // Normalize line endings to LF
     const normalized = utf8.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
     return Buffer.from(normalized, 'utf-8');
   }
   ```

2. **Integration Points:**
   - `configUploads.ts`: When saving/reading uploaded configs
   - `buildQueue.ts`: When materializing configs for build
   - `projectScanner.ts`: When computing config hashes

3. **Backward Compatibility:**
   - Existing hashes may change after implementation
   - Document the change in manifest schema version
   - Option to use old hashing method for existing projects

## Benefits

- **Determinism:** Same content produces same hash on all platforms
- **Reproducibility:** Builds are more consistent across environments
- **Verification:** Easier to verify config integrity

## Priority

**Low** - Current hashing works, just not perfectly deterministic. This is a polish/enhancement for better reproducibility, not required for MVP.

