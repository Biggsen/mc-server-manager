# World Snapshot Binding - Implementation Spec

## Overview

Add a simple world snapshot feature that allows a project to use another project's world data as a snapshot source. When running locally, users can optionally copy world data from the bound snapshot source project's workspace.

This is a simplified approach compared to the original snapshot spec - instead of creating immutable snapshot artifacts, projects can directly reference other projects as snapshot sources.

---

## User Flow

1. **Configure Snapshot Binding**: In a project's "World Snapshot" tab, select another project to use as a snapshot source
2. **Run with Snapshot**: When starting a local run, check "Use snapshot" in the Run Options dialog (only appears if a snapshot binding is set)
3. **World Copy**: The system copies all world dimensions from the source project's workspace to the current project's workspace before starting the server

---

## Data Model Changes

### Backend Types

**`backend/src/types/storage.ts`**
```typescript
export interface StoredProject {
  // ... existing fields
  snapshotSourceProjectId?: string;  // ID of project to use as snapshot source
}
```

**`backend/src/types/projects.ts`**
```typescript
export interface ProjectSummary {
  // ... existing fields
  snapshotSourceProjectId?: string;  // ID of project to use as snapshot source
}
```

**`backend/src/services/runQueue.ts`**
```typescript
export interface RunOptions {
  resetWorld?: boolean;
  resetPlugins?: boolean;
  useSnapshot?: boolean;  // NEW: Copy world from snapshot source
}
```

### Frontend Types

**`frontend/src/lib/api.ts`**
```typescript
export interface ProjectSummary {
  // ... existing fields
  snapshotSourceProjectId?: string;
}

export async function runProjectLocally(
  projectId: string,
  options?: { 
    resetWorld?: boolean; 
    resetPlugins?: boolean;
    useSnapshot?: boolean;  // NEW
  }
): Promise<RunJob>

export async function updateProject(
  projectId: string,
  payload: {
    name?: string
    minecraftVersion?: string
    loader?: string
    description?: string
    snapshotSourceProjectId?: string;  // NEW
  },
): Promise<ProjectSummary>
```

---

## UI Changes

### 1. New "World Snapshot" Tab

**Location**: `frontend/src/pages/ProjectDetail.tsx`

Add a new tab in the Tabs.List:
```tsx
<Tabs.Tab value="snapshot">World Snapshot</Tabs.Tab>
```

**Tab Content**:
- Card with title "Snapshot Source"
- NativeSelect dropdown showing all projects (excluding current project)
- Option to clear/remove snapshot binding
- Help text explaining what this does
- Note about seed being ignored when using snapshots

**UI Elements**:
- Dropdown: Select snapshot source project (empty option = "None")
- Current selection display
- Clear button (if a binding exists)
- Info text: "When 'Use snapshot' is enabled in Run Options, world data will be copied from the selected project's workspace."

### 2. Run Options Dialog Updates

**Location**: `frontend/src/pages/ProjectDetail.tsx`

**Changes**:
1. Update `runOptions` state to include `useSnapshot: boolean`
2. Add conditional checkbox (only shown if `project?.snapshotSourceProjectId` exists):
   ```tsx
   {project?.snapshotSourceProjectId && (
     <Checkbox
       label="Use snapshot"
       checked={runOptions.useSnapshot}
       disabled={runOptions.resetWorld}
       onChange={(event) => {
         if (event.target.checked) {
           setRunOptions(prev => ({ ...prev, useSnapshot: true, resetWorld: false }))
         } else {
           setRunOptions(prev => ({ ...prev, useSnapshot: false }))
         }
       }}
       description={`Copy world from ${snapshotSourceProjectName || 'snapshot source'}`}
     />
   )}
   ```
3. Update "Reset world data" checkbox to disable when `useSnapshot` is checked
4. Mutual exclusivity: When one is checked, the other is disabled and unchecked

---

## Backend Implementation

### 1. API Endpoint Updates

**File**: `backend/src/routes/projects.ts`

Update the PUT `/:id` endpoint to accept `snapshotSourceProjectId`:
```typescript
router.put("/:id", async (req: Request, res: Response) => {
  const { name, minecraftVersion, loader, description, snapshotSourceProjectId } = req.body ?? {};
  
  const updated = await updateProject(id, (p) => {
    // ... existing updates
    if (typeof snapshotSourceProjectId === "string") {
      p.snapshotSourceProjectId = snapshotSourceProjectId.trim() || undefined;
    }
    return p;
  });
});
```

**Validation**:
- If `snapshotSourceProjectId` is provided, verify the target project exists
- Prevent self-reference (source project cannot be the same as current project)
- Allow empty string to clear the binding

### 2. Storage Updates

**File**: `backend/src/storage/projectsStore.ts`

The `updateProject` function already handles arbitrary field updates, so no changes needed. The `toSummary` function should include the new field:
```typescript
function toSummary(project: StoredProject): ProjectSummary {
  return {
    // ... existing fields
    snapshotSourceProjectId: project.snapshotSourceProjectId,
  };
}
```

### 3. Snapshot Copy Implementation

**File**: `backend/src/services/runQueue.ts`

**New Function**: `copyWorldFromSnapshot`
```typescript
async function copyWorldFromSnapshot(
  targetWorkspaceDir: string,
  sourceProjectId: string,
  job: RunJob,
  project: StoredProject
): Promise<void> {
  const sourceWorkspaceDir = getProjectWorkspacePath(sourceProjectId);
  
  // Check if source workspace exists
  try {
    await access(sourceWorkspaceDir);
  } catch {
    throw new Error(`Snapshot source project workspace not found. The source project may not have been run yet.`);
  }
  
  // Read server.properties to determine world name
  const serverPropsPath = join(targetWorkspaceDir, "server.properties");
  let worldName = "world";
  
  try {
    const serverProps = await readFile(serverPropsPath, "utf-8");
    const levelNameMatch = serverProps.match(/^level-name\s*=\s*(.+)$/m);
    if (levelNameMatch && levelNameMatch[1]) {
      worldName = levelNameMatch[1].trim();
    }
  } catch (error) {
    appendLog(job, "system", `Could not read server.properties, using default world name "world"`);
  }
  
  // List of world dimensions to copy
  const worldDims = [worldName, `${worldName}_nether`, `${worldName}_the_end`];
  
  let copiedAny = false;
  
  for (const dim of worldDims) {
    const sourcePath = join(sourceWorkspaceDir, dim);
    const targetPath = join(targetWorkspaceDir, dim);
    
    try {
      // Check if source dimension exists
      const stats = await stat(sourcePath);
      if (!stats.isDirectory()) {
        continue;
      }
      
      // Remove target if it exists
      await rm(targetPath, { recursive: true, force: true });
      
      // Copy directory
      await cp(sourcePath, targetPath, { recursive: true });
      copiedAny = true;
      appendLog(job, "system", `Copied world dimension: ${dim}`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        // Source dimension doesn't exist - that's okay, skip it
        continue;
      }
      throw new Error(`Failed to copy world dimension ${dim}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  if (!copiedAny) {
    throw new Error(`No world data found in snapshot source project workspace. The source project may need to be run first.`);
  }
  
  appendLog(job, "system", `World snapshot copied successfully from project ${sourceProjectId}`);
}
```

**Update `prepareWorkspace` function**:
```typescript
async function prepareWorkspace(job: RunJob, project: StoredProject): Promise<string> {
  await mkdir(WORKSPACE_ROOT, { recursive: true });
  const workspaceDir = getProjectWorkspacePath(project.id);
  await mkdir(workspaceDir, { recursive: true });

  const options = job.resetOptions;
  
  // Handle snapshot copy BEFORE reset operations
  if (options?.useSnapshot) {
    if (!project.snapshotSourceProjectId) {
      throw new Error("useSnapshot is enabled but no snapshot source project is configured");
    }
    await copyWorldFromSnapshot(workspaceDir, project.snapshotSourceProjectId, job, project);
  }
  
  // Reset operations (mutually exclusive with snapshot)
  if (options?.resetWorld) {
    await resetWorldData(workspaceDir, job, project);
  }
  if (options?.resetPlugins) {
    await resetPluginData(workspaceDir, job);
  }

  // ... rest of function
}
```

**Update `enqueueRun` function**:
```typescript
export async function enqueueRun(project: StoredProject, options: RunOptions = {}): Promise<RunJob> {
  // ... existing validation
  
  // Validate snapshot options
  if (options.useSnapshot && !project.snapshotSourceProjectId) {
    throw new Error("Cannot use snapshot: no snapshot source project is configured");
  }
  
  if (options.useSnapshot && options.resetWorld) {
    throw new Error("Cannot use snapshot and reset world data simultaneously");
  }
  
  // ... rest of function
  const job: RunJob = {
    // ... existing fields
    resetOptions: (options.resetWorld || options.resetPlugins || options.useSnapshot) ? options : undefined,
  };
}
```

---

## Error Handling

### Validation Errors

1. **No snapshot source configured**: If `useSnapshot` is true but `snapshotSourceProjectId` is not set
   - Error: "Cannot use snapshot: no snapshot source project is configured"
   - Prevent run from starting

2. **Source workspace doesn't exist**: If source project has never been run
   - Error: "Snapshot source project workspace not found. The source project may not have been run yet."
   - Prevent run from starting

3. **No world data in source**: If source workspace exists but has no world folders
   - Error: "No world data found in snapshot source project workspace. The source project may need to be run first."
   - Prevent run from starting

4. **Mutually exclusive options**: If both `useSnapshot` and `resetWorld` are true
   - Error: "Cannot use snapshot and reset world data simultaneously"
   - Prevent run from starting

5. **Self-reference**: If user tries to set current project as its own snapshot source
   - Error: "A project cannot use itself as a snapshot source"
   - Prevent binding from being saved

---

## File Structure

### Files to Modify

1. **Type Definitions**:
   - `backend/src/types/storage.ts` - Add `snapshotSourceProjectId` to `StoredProject`
   - `backend/src/types/projects.ts` - Add `snapshotSourceProjectId` to `ProjectSummary`
   - `frontend/src/lib/api.ts` - Add `snapshotSourceProjectId` to `ProjectSummary` and update function signatures

2. **Backend API**:
   - `backend/src/routes/projects.ts` - Accept `snapshotSourceProjectId` in PUT endpoint
   - `backend/src/storage/projectsStore.ts` - Include field in `toSummary` function

3. **Backend Run Logic**:
   - `backend/src/services/runQueue.ts` - Add `useSnapshot` to `RunOptions`, implement `copyWorldFromSnapshot`, update `prepareWorkspace` and `enqueueRun`

4. **Frontend UI**:
   - `frontend/src/pages/ProjectDetail.tsx` - Add World Snapshot tab, update Run Options dialog

---

## Testing Considerations

### Manual Testing Checklist

1. **Snapshot Binding**:
   - [ ] Can set snapshot source project
   - [ ] Cannot set self as snapshot source
   - [ ] Can clear snapshot binding
   - [ ] Binding persists after page reload

2. **Run Options**:
   - [ ] "Use snapshot" checkbox only appears when binding is set
   - [ ] "Use snapshot" and "Reset world data" are mutually exclusive
   - [ ] Both can be unchecked (normal run behavior)

3. **Snapshot Copy**:
   - [ ] Successfully copies world from source workspace
   - [ ] Copies all dimensions (world, world_nether, world_the_end) if they exist
   - [ ] Handles missing dimensions gracefully
   - [ ] Shows appropriate error if source has no world data
   - [ ] Shows appropriate error if source workspace doesn't exist

4. **Edge Cases**:
   - [ ] Source project deleted after binding is set
   - [ ] Source project workspace cleared/reset
   - [ ] Running with snapshot when source has never been run

---

## Documentation Notes

- **Seed Configuration**: When using a snapshot, the world seed configured in the profile is ignored since the world is copied, not generated. This should be documented in the UI (help text in World Snapshot tab).

---

## Implementation Order

1. Add type definitions (backend and frontend)
2. Update API endpoints to accept `snapshotSourceProjectId`
3. Implement snapshot copy function in `runQueue.ts`
4. Update `prepareWorkspace` and `enqueueRun` to handle snapshot option
5. Add World Snapshot tab UI
6. Update Run Options dialog UI
7. Test end-to-end flow

---

## Future Enhancements (Out of Scope)

- Snapshot versioning/immutability
- Snapshot export/import as artifacts
- Snapshot metadata (creation date, size, etc.)
- Multiple snapshot sources per project
- Snapshot preview/validation before use
