# Deterministic Folder Hashing

## Overview

Sort file paths deterministically when computing folder hashes (e.g., for datapacks). This ensures consistent hashes for the same folder contents regardless of filesystem ordering.

## Current State

- Folder hashes are computed by iterating files
- File iteration order may vary by filesystem
- **Hashes may differ** for the same folder contents on different systems

## Enhancement

### Sorted Path Hashing

1. **Process:**
   ```
   For folder hash:
   1. Recursively collect all files in folder
   2. Sort file paths alphabetically (case-sensitive)
   3. Hash each file in sorted order
   4. Combine hashes deterministically
   ```

2. **Hash Combination:**
   - Use consistent method to combine individual file hashes
   - Include relative path in hash computation
   - Handle empty folders consistently

3. **Implementation:**
   - Add `hashFolder` function that sorts paths
   - Use for datapack folder hashing
   - Apply to any folder-based asset hashing

## Implementation

1. **Folder Hashing Function:**
   ```typescript
   async function hashFolder(folderPath: string): Promise<string> {
     const files: string[] = [];
     // Recursively collect all files
     await walkDirectory(folderPath, (filePath) => {
       files.push(relativePath);
     });
     // Sort paths deterministically
     files.sort();
     // Hash each file in order
     const hashes = await Promise.all(
       files.map(async (file) => {
         const content = await readFile(join(folderPath, file));
         return hashBuffer(content);
       })
     );
     // Combine hashes
     return hashBuffer(Buffer.from(hashes.join('\n')));
   }
   ```

2. **Integration:**
   - Update datapack hashing in `projectScanner.ts`
   - Apply to any folder-based assets in manifests

## Benefits

- **Determinism:** Same folder contents produce same hash
- **Reproducibility:** Consistent across different filesystems
- **Verification:** Reliable folder integrity checking

## Priority

**Low** - Current folder hashing works for most cases. This ensures perfect determinism across all platforms, which is a polish enhancement.

