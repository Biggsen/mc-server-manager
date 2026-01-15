# Config System Refactor - Detailed Specification

**Status**: ✅ **COMPLETED** - All phases implemented and tested

## Overview
Comprehensive refactor of the config system to:
1. Clarify library configs vs custom configs using discriminated union
2. Remove requirement field (contextual, not inherent to configs)
3. Fix deletion issue (configs in project directory not being found)
4. Improve UI/UX with proper terminology (Config Template vs Custom Config)
5. Prevent path conflicts (validate custom configs don't match library definitions)

---

## Config Storage Architecture: `config/uploads/` vs Materialized Locations

### How It Works

The system uses a two-stage storage pattern for configuration files:

#### 1. **`config/uploads/` (Staging Area)**
- **Location**: `{projectRoot}/config/uploads/{relativePath}`
- **Example**: `config/uploads/plugins/advancedachievements/config.yml`
- **Purpose**: This is the **source of truth** and **staging area** for user-uploaded configurations
- **Lifecycle**:
  - Files are uploaded here via the UI (`POST /:id/configs/upload`)
  - Files persist here **even after builds are completed**
  - This directory is read by `collectUploadedConfigMaterials()` during builds
  - Files are managed directly by users through the UI
- **Persistence**: Files remain in this location indefinitely until explicitly deleted

#### 2. **Materialized Locations (Runtime)**
- **Location**: `{projectRoot}/{relativePath}` (e.g., `plugins/advancedachievements/config.yml`)
- **Purpose**: This is where the **server actually reads configurations from at runtime**
- **Lifecycle**:
  - Files are written here during builds by `materializeConfigs()` function (line 439 in `buildQueue.ts`)
  - The function `writeProjectFileBuffer()` writes to these locations
  - These files are created from the staging area (`config/uploads/`) during each build
  - Both staging and materialized files are included in the build zip artifact
- **Generation**: Created fresh on each build from staging area + rendered configs

### Why This Design?

1. **Separation of Concerns**:
   - `config/uploads/`: User-managed, persistent source files
   - Materialized locations: Build-generated, runtime files

2. **Build Process**:
   - Builds read from `config/uploads/` (via `collectUploadedConfigMaterials()`)
   - Builds write to materialized locations (via `writeProjectFileBuffer()`)
   - This ensures builds always use the latest user-uploaded configs

3. **Similar Pattern to Plugins**:
   - Plugins follow a similar pattern: uploaded plugins go to `plugins/uploads/` first, then are materialized to `plugins/` during builds

### Deletion Behavior

**Critical Issue (Fixed)**: When deleting a config file, both locations must be cleaned up:

1. **Staging Area** (`config/uploads/`): Must be deleted to prevent the config from being included in future builds
2. **Materialized Location**: Must be deleted to remove the file from the current project state

**Previous Bug**: The deletion logic only attempted one location at a time. If a file existed in both:
- Deleting from `config/uploads/` would succeed, but the materialized file would remain
- This caused stale configs to persist and potentially reappear on scans

**Fixed Behavior**: The deletion endpoint now:
1. Always attempts to delete from `config/uploads/` (staging area)
2. Always attempts to delete from the materialized location (project root)
3. Both operations are independent - one failing doesn't prevent the other
4. Metadata is always removed regardless of file deletion success

### Example Flow

1. **Upload**: User uploads `plugins/advancedachievements/config.yml`
   - File saved to: `config/uploads/plugins/advancedachievements/config.yml`
   - Metadata added to `project.configs[]`

2. **Build**: Build process runs
   - `collectUploadedConfigMaterials()` reads from `config/uploads/plugins/advancedachievements/config.yml`
   - `materializeConfigs()` writes to `plugins/advancedachievements/config.yml`
   - Both files now exist in the project

3. **Runtime**: Server reads from `plugins/advancedachievements/config.yml` (materialized location)

4. **Delete**: User deletes the config
   - Both `config/uploads/plugins/advancedachievements/config.yml` AND `plugins/advancedachievements/config.yml` are deleted
   - Metadata removed from `project.configs[]`

---

## Goals
- **Type Safety**: Discriminated union makes library vs custom distinction explicit
- **Simplicity**: Remove requirement field that adds no functional value
- **Reliability**: Fix deletion to work from all storage locations
- **Clarity**: Better terminology and UI flow
- **Prevention**: Validate uploads to prevent path conflicts between custom and library configs

---

## Part 1: Type System Refactor

### 1.1 Backend Types (`backend/src/types/plugins.ts`)

#### Remove Requirement
- Remove `requirement?: PluginConfigRequirement` from `PluginConfigDefinition`
- Remove `requirement?: PluginConfigRequirement` from `ProjectPluginConfigMapping`
- Remove `PluginConfigRequirement` type (if not used elsewhere)
- Remove `export type PluginConfigRequirement = "required" | "optional" | "generated"`

#### Discriminated Union
Replace `ProjectPluginConfigMapping` with:

```typescript
type ProjectPluginConfigMapping =
  | {
      type: 'library';
      definitionId: string;  // References PluginConfigDefinition.id
      notes?: string;
      // NO path - always uses library definition's path
      // NO requirement - removed
    }
  | {
      type: 'custom';
      customId: string;  // e.g., "custom/crazycrates-regioncrate"
      label: string;  // Required
      path: string;  // Required
      notes?: string;
      // NO requirement - removed
    };
```

#### Update View Interface
```typescript
interface PluginConfigDefinitionView {
  id: string;
  type: 'library' | 'custom';  // NEW
  source: 'library' | 'custom';  // Keep for backward compat, same as type
  label?: string;
  description?: string;
  tags?: string[];
  defaultPath: string;
  resolvedPath: string;
  notes?: string;
  mapping?: ProjectPluginConfigMapping;
  uploaded?: ProjectConfigSummary;
  // REMOVED: requirement, missing
}
```

### 1.2 Backend Routes - Remove Requirement Logic (`backend/src/routes/projects.ts`)

#### Remove Functions/Constants
- Remove `normalizeRequirement` function (lines ~106-120)
- Remove `PLUGIN_CONFIG_REQUIREMENTS` constant (line ~104)

#### Update `buildPluginConfigViews` Function
**Current logic (lines 201-225):**
```typescript
const resolvedRequirement = mapping
  ? normalizeRequirement(mapping.requirement, definition.requirement ?? "optional")
  : normalizeRequirement(definition.requirement, "optional");
// ...
missing: resolvedRequirement === "required" && !uploaded,
```

**New logic (replace the entire function body):**
```typescript
for (const definition of libraryDefinitions) {
  const mapping = mappingById.get(definition.id);
  // Library configs: ALWAYS use definition.path, never mapping.path
  const resolvedPath = definition.path;  // No override allowed
  const uploaded = resolveUpload(definition.id, resolvedPath);
  if (uploaded) {
    matchedSummaries.add(uploaded);
  }
  views.push({
    id: definition.id,
    type: 'library',
    source: 'library',
    label: definition.label,
    description: definition.description,
    tags: definition.tags,
    defaultPath: definition.path,
    resolvedPath,  // Always same as defaultPath for library
    notes: mapping?.notes,
    mapping: mapping ? { type: 'library', definitionId: definition.id, notes: mapping.notes } : undefined,
    uploaded,
    // REMOVED: requirement, missing
  });
}

for (const mapping of mappings) {
  // Skip if this is already handled as a library config
  if (definitionMap.has(mapping.definitionId)) {
    continue;
  }
  
  // Determine if this is a custom config
  // Migration: old format without type field - treat as custom if not in library
  const isCustom = mapping.type === 'custom' || 
                   (!mapping.type && !definitionMap.has(mapping.definitionId));
  
  if (!isCustom) {
    continue;  // Skip non-custom mappings that aren't in library
  }
  
  // For custom configs, path is required
  // Old format: use definitionId as customId if it starts with 'custom/'
  // New format: use customId field
  const customId = (mapping as any).customId || 
                   (mapping.definitionId.startsWith('custom/') 
                     ? mapping.definitionId 
                     : `custom/${mapping.definitionId}`);
  const resolvedPath = mapping.path;  // Required for custom
  if (!resolvedPath) {
    continue;  // Invalid custom config without path
  }
  
  const uploaded = resolveUpload(customId, resolvedPath);
  if (uploaded) {
    matchedSummaries.add(uploaded);
  }
  
  views.push({
    id: customId,
    type: 'custom',
    source: 'custom',
    label: mapping.label || customId,  // Required for custom, fallback to customId
    description: undefined,
    tags: undefined,
    defaultPath: resolvedPath,
    resolvedPath,
    notes: mapping.notes,
    mapping: {
      type: 'custom',
      customId,
      label: mapping.label || customId,
      path: resolvedPath,
      notes: mapping.notes,
    },
    uploaded,
    // REMOVED: requirement, missing
  });
}
```

#### Update PUT Endpoint (`/:id/plugins/:pluginId/configs`)
**Current validation (lines ~1432-1461):**
- Remove requirement parsing/validation
- Add type validation

**New validation:**
```typescript
// Parse type field
const typeValue = (raw as { type?: unknown }).type;
if (typeValue !== 'library' && typeValue !== 'custom') {
  res.status(400).json({ error: `mappings[${index}].type must be 'library' or 'custom'` });
  return;
}

if (typeValue === 'library') {
  // Library mapping validation
  if (!definitionIdValue) {
    res.status(400).json({ error: `mappings[${index}].definitionId is required for library type` });
    return;
  }
  // Validate definitionId references library definition
  if (!libraryDefinitions.some(d => d.id === definitionIdValue)) {
    res.status(400).json({ error: `mappings[${index}].definitionId must reference a library definition` });
    return;
  }
  // Reject path if provided (library configs can't override path)
  if (pathValue) {
    res.status(400).json({ error: `mappings[${index}].path cannot be provided for library type` });
    return;
  }
  normalized = {
    type: 'library',
    definitionId: definitionIdValue,
    notes: notesValue,
  };
} else {
  // Custom mapping validation
  if (!pathValue) {
    res.status(400).json({ error: `mappings[${index}].path is required for custom type` });
    return;
  }
  const labelValue = typeof (raw as { label?: unknown }).label === "string"
    ? (raw as { label: string }).label.trim()
    : undefined;
  if (!labelValue) {
    res.status(400).json({ error: `mappings[${index}].label is required for custom type` });
    return;
  }
  // Generate customId if not provided
  const customIdValue = definitionIdValue.startsWith('custom/')
    ? definitionIdValue
    : `custom/${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  normalized = {
    type: 'custom',
    customId: customIdValue,
    label: labelValue,
    path: pathValue,
    notes: notesValue,
  };
}
```

### 1.3 Plugin Routes (`backend/src/routes/plugins.ts`)

#### Remove Requirement Parsing
**Current (lines ~120-132):**
- Remove requirement parsing from `parseConfigDefinitions`
- Remove `CONFIG_REQUIREMENTS` constant (line ~75)
- Remove requirement validation logic

**New:**
```typescript
// Simply don't parse requirement field
// If provided, ignore it (for backward compatibility during migration)
```

### 1.4 Project Scanner (`backend/src/services/projectScanner.ts`)

#### Update Path Resolution
**Current (line ~152):**
```typescript
const resolvedPath = mapping?.path ?? definition.path;
```

**New:**
```typescript
// For library definitions: always use definition.path
const resolvedPath = definition.path;  // No override
// mapping.path is ignored for library configs
```

**For custom configs (line ~231):**
```typescript
// Custom configs must have path
// Note: This is in the second loop that processes mappings not in library definitions
if (mapping.type !== 'custom') {
  // Migration: old format without type field
  // If definitionId doesn't match library, treat as custom
  if (!mapping.path) {
    continue;  // Invalid custom config without path
  }
}
const resolvedPath = mapping.path ?? "";
if (!resolvedPath) {
  continue;  // Invalid custom config
}
```

---

## Part 2: Fix Config Deletion Issue

### 2.1 Update Delete Endpoint (`backend/src/routes/projects.ts`)

**Current (lines ~1681-1712):**
- Only checks `config/uploads/` directory
- Returns 404 if file not found in uploads
- Does not check project directory or dev directories

**New implementation:**
```typescript
router.delete("/:id/configs/file", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { path } = req.query;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    if (typeof path !== "string" || path.trim().length === 0) {
      res.status(400).json({ error: "path query parameter is required" });
      return;
    }
    
    const sanitized = sanitizeRelativePath(path);
    let deleted = false;
    
    // Try to delete from config/uploads first
    try {
      await deleteUploadedConfigFile(project, path);
      deleted = true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        throw error;
      }
      // File not in uploads directory, try project directory
    }
    
    // If not found in uploads, try the actual project directory
    if (!deleted) {
      const projectRoot = join(getProjectsRoot(), project.id);
      const projectPath = join(projectRoot, sanitized);
      
      let filePath: string | undefined;
      if (existsSync(projectPath)) {
        filePath = projectPath;
      } else {
        // Also check dev directory paths
        const devDataPaths = getDevDataPaths();
        for (const devDataPath of devDataPaths) {
          const devPath = join(devDataPath, "projects", project.id, sanitized);
          if (existsSync(devPath)) {
            filePath = devPath;
            break;
          }
        }
      }
      
      if (filePath) {
        try {
          await unlink(filePath);
          deleted = true;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code !== "ENOENT") {
            throw error;
          }
        }
      }
    }
    
    // Always remove metadata entry, even if file wasn't found
    // (file might have been manually deleted or never existed)
    await removeProjectConfigMetadata(id, project, path);
    
    const refreshed = (await findProject(id)) ?? project;
    const configs = await listUploadedConfigFiles(refreshed);
    res.status(200).json({ configs });
  } catch (error) {
    console.error("Failed to delete config file", error);
    res.status(500).json({ error: "Failed to delete config file" });
  }
});
```

#### Add Imports
```typescript
import { unlink } from "fs/promises";
import { existsSync } from "fs";
import { sanitizeRelativePath } from "../services/configUploads";
import { getProjectsRoot, getDevDataPaths } from "../config";
```

**Note:** `sanitizeRelativePath` already exists in `backend/src/services/configUploads.ts`, so no new function needs to be created.

---

## Part 3: UI Refactor

### 3.1 Frontend Types (`frontend/src/lib/api.ts`)

#### Remove Requirement
- Remove `requirement` from `PluginConfigDefinition`
- Remove `requirement` from `ProjectPluginConfigMapping`
- Remove `requirement` from `PluginConfigDefinitionView`
- Remove `PluginConfigRequirement` type

#### Update to Discriminated Union
```typescript
export type ProjectPluginConfigMapping =
  | {
      type: 'library'
      definitionId: string
      notes?: string
    }
  | {
      type: 'custom'
      customId: string
      label: string
      path: string
      notes?: string
    }

export interface PluginConfigDefinitionView {
  id: string
  type: 'library' | 'custom'  // NEW
  source: 'library' | 'custom'  // Keep for backward compat
  label?: string
  description?: string
  tags?: string[]
  defaultPath: string
  resolvedPath: string
  notes?: string
  mapping?: ProjectPluginConfigMapping
  uploaded?: ProjectConfigSummary
  // REMOVED: requirement, missing
}
```

### 3.2 Upload Form (`frontend/src/pages/ProjectDetail.tsx`)

#### Replace Config Mapping Dropdown with Radio Buttons
**Current (lines ~2561-2585):**
```typescript
<NativeSelect
  label="Config mapping"
  data={[{ value: '', label: 'None' }, ...]}
/>
```

**New:**
```typescript
<Radio.Group
  label="Config Type"
  value={configUploadType}  // 'template' | 'custom'
  onChange={(value) => {
    setConfigUploadType(value as 'template' | 'custom')
    setConfigUploadDefinition('')
    setConfigUploadPath('')
    setConfigUploadPathDirty(false)
  }}
>
  <Radio value="template" label="Use Config Template" />
  <Radio value="custom" label="Create Custom Config" />
</Radio.Group>

{configUploadType === 'template' && (
  <>
    <NativeSelect
      label="Config Template"
      value={configUploadDefinition}
      onChange={(event) => {
        const value = event.currentTarget.value
        setConfigUploadDefinition(value)
        const options = pluginDefinitionOptions[configUploadPlugin] ?? []
        const selected = options.find((option) => option.definitionId === value)
        if (selected) {
          setConfigUploadPath(selected.path)
          setConfigUploadPathDirty(false)
        }
      }}
      disabled={!configUploadPlugin}
      required
      data={[
        ...(pluginDefinitionOptions[configUploadPlugin] ?? []).map((option) => ({
          value: option.definitionId,
          label: option.label,
        })),
      ]}
    />
    {selectedDefinition?.path && (
      <TextInput
        label="Path"
        value={selectedDefinition.path}
        readOnly
        disabled
        styles={{ input: { backgroundColor: 'var(--mantine-color-gray-1)' } }}
      />
    )}
  </>
)}

{configUploadType === 'custom' && (
  <>
    <TextInput
      label="Config Name"
      value={configUploadName}
      onChange={(event) => setConfigUploadName(event.target.value)}
      placeholder="My Custom Config"
      required
    />
    <TextInput
      label="Relative Path"
      value={configUploadPath}
      onChange={(event) => {
        setConfigUploadPath(event.target.value)
        setConfigUploadPathDirty(true)
      }}
      placeholder="plugins/MyPlugin/config.yml"
      required
    />
  </>
)}
```

#### Update Upload Handler
```typescript
const handleUploadConfig = useCallback(
  async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!id) return
    
    if (configUploadType === 'template') {
      if (!configUploadDefinition.trim()) {
        setConfigsError('Config template is required.')
        return
      }
    } else {
      if (!configUploadName.trim() || !configUploadPath.trim()) {
        setConfigsError('Config name and path are required.')
        return
      }
    }
    
    if (!configUploadFile) {
      setConfigsError('Config file is required.')
      return
    }
    
    try {
      setConfigUploadBusy(true)
      
      // Determine payload based on type
      const payload: {
        path: string
        file: File
        type: 'library' | 'custom'
        definitionId?: string
        customId?: string
        label?: string
      } = {
        path: configUploadPath.trim(),
        file: configUploadFile,
        type: configUploadType === 'template' ? 'library' : 'custom',
      }
      
      if (configUploadType === 'template') {
        payload.definitionId = configUploadDefinition.trim()
      } else {
        payload.customId = `custom/${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
        payload.label = configUploadName.trim()
      }
      
      const configs = await uploadProjectConfig(id, payload)
      // ... rest of handler
    } catch (err) {
      // ... error handling
    }
  },
  [id, configUploadType, configUploadDefinition, configUploadName, configUploadPath, configUploadFile]
)
```

#### Update API Function
```typescript
export async function uploadProjectConfig(
  projectId: string,
  payload: {
    path: string
    file: File
    type: 'library' | 'custom'
    definitionId?: string
    customId?: string
    label?: string
  },
): Promise<ProjectConfigSummary[]> {
  const form = new FormData()
  form.append('relativePath', payload.path)
  form.append('file', payload.file)
  form.append('type', payload.type)
  if (payload.definitionId) {
    form.append('definitionId', payload.definitionId)
  }
  if (payload.customId && payload.label) {
    form.append('customId', payload.customId)
    form.append('label', payload.label)
  }
  // ... rest of function
}
```

### 3.3 Config Paths Display (`frontend/src/pages/ProjectDetail.tsx`)

#### Remove Requirement/Missing UI
**Remove (lines ~280-284, ~302-321, ~351-370):**
- Remove `missingCount` calculation
- Remove missing count badge
- Remove requirement badges
- Remove "Missing" badges

#### Consolidate Display
**Current:** Separate "Library Paths" and "Custom Paths" sections

**New:** Single unified list with source badges

```typescript
<Stack gap="xs">
  <Text size="xs" fw={600} c="dimmed" tt="uppercase">
    Config Paths
  </Text>
  {pluginDefinitions.map((definition) => (
    <Group key={definition.id} justify="space-between" align="flex-start" wrap="nowrap">
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="wrap">
          <Badge variant={definition.type === 'library' ? 'blue' : 'gray'}>
            {definition.type === 'library' ? 'Template' : 'Custom'}
          </Badge>
          <Text size="sm" fw={500}>
            {definition.label || definition.id}
          </Text>
          {definition.uploaded ? (
            <Badge variant="success">
              Uploaded
            </Badge>
          ) : null}
        </Group>
        <Text size="xs" c="dimmed" style={{ wordBreak: 'break-all' }}>
          {definition.resolvedPath}
        </Text>
        {definition.description && (
          <Text size="xs" c="dimmed">
            {definition.description}
          </Text>
        )}
        {definition.notes && (
          <Text size="xs" c="dimmed">
            Notes: {definition.notes}
          </Text>
        )}
      </Stack>
      {definition.type === 'custom' && (
        <Group gap="xs">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onEditCustomPath({...})}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onRemoveCustomPath({...})}
          >
            Remove
          </Button>
        </Group>
      )}
    </Group>
  ))}
</Stack>
```

### 3.4 Custom Path Modal (`frontend/src/components/CustomPathModal.tsx`)

#### Remove Requirement Field
- Remove requirement select/dropdown (lines ~109-124)
- Update form state to remove requirement
- Update submit handler

### 3.5 Plugin Library (`frontend/src/pages/PluginLibrary.tsx`)

#### Remove Requirement from Editor
- Remove requirement field from config definition editor (lines ~537-563)
- Remove requirement from draft type
- Remove requirement from form inputs

---

## Part 4: Validation & Path Conflict Prevention

### 4.1 Upload Validation (`backend/src/routes/projects.ts`)

**Add helper function before the upload endpoint:**

```typescript
// Add helper function
async function findLibraryDefinitionForPath(
  project: StoredProject,
  path: string,
): Promise<{ pluginId: string; definitionId: string; label?: string } | undefined> {
  for (const plugin of project.plugins ?? []) {
    if (!plugin.version) continue;
    
    const stored = await findStoredPlugin(plugin.id, plugin.version);
    if (!stored?.configDefinitions) continue;
    
    for (const definition of stored.configDefinitions) {
      if (definition.path === path) {
        return {
          pluginId: plugin.id,
          definitionId: definition.id,
          label: definition.label,
        };
      }
    }
  }
  return undefined;
}

// Update upload endpoint (router.post("/:id/configs/upload", ...))
// Add this validation logic after existing path/plugin validation and before file processing:

```typescript
// ... existing validation (path, plugin, file checks) ...

const typeValue = typeof req.body?.type === "string" ? req.body.type : undefined;
  const definitionIdValue = typeof req.body?.definitionId === "string" ? req.body.definitionId.trim() : undefined;
  const customIdValue = typeof req.body?.customId === "string" ? req.body.customId.trim() : undefined;
  const labelValue = typeof req.body?.label === "string" ? req.body.label.trim() : undefined;
  
  // Validate based on type
  if (typeValue === 'custom') {
    // Check if path conflicts with library definition
    const libraryConflict = await findLibraryDefinitionForPath(project, relativePath);
    if (libraryConflict) {
      res.status(400).json({
        error: `Path "${relativePath}" matches a library config template for plugin "${libraryConflict.pluginId}" (${libraryConflict.label || libraryConflict.definitionId}). Please use "Use Config Template" mode instead.`,
      });
      return;
    }
    
    if (!labelValue) {
      res.status(400).json({ error: "label is required for custom config" });
      return;
    }
  } else if (typeValue === 'library') {
    if (!definitionIdValue) {
      res.status(400).json({ error: "definitionId is required for library config" });
      return;
    }
    
    // Validate path matches library definition
    const plugin = project.plugins?.find((p) => p.id === pluginIdValue);
    if (plugin?.version) {
      const stored = await findStoredPlugin(plugin.id, plugin.version);
      const definition = stored?.configDefinitions?.find((d) => d.id === definitionIdValue);
      if (definition && definition.path !== relativePath) {
        res.status(400).json({
          error: `Path must match library template path: "${definition.path}"`,
        });
        return;
      }
    }
  }
  
  // ... rest of upload logic (file saving, metadata updates, etc.) ...
}
```

**Note:** The validation should happen after basic path/plugin validation but before any file operations to provide early feedback to users.

---

## Part 5: Testing Checklist

### 5.1 Type System
- [ ] Library config: type='library', no path field, definitionId required
- [ ] Custom config: type='custom', path and label required, customId generated
- [ ] Backward compatibility: old format without type field loads correctly
- [ ] Path resolution: library always uses definition.path, custom uses mapping.path
- [ ] Migration: old format mappings converted correctly (library vs custom detection)
- [ ] Type validation: API rejects invalid type values with clear error messages

### 5.2 Deletion
- [ ] Delete from config/uploads/ works
- [ ] Delete from project directory works
- [ ] Delete from dev directory works
- [ ] Delete when file doesn't exist (metadata only) works
- [ ] Metadata always removed

### 5.3 UI
- [ ] Upload form: Template mode shows template dropdown, path read-only
- [ ] Upload form: Custom mode shows name + path inputs
- [ ] Config display: Shows unified list with Template/Custom badges
- [ ] No requirement badges shown
- [ ] No missing warnings shown

### 5.4 Validation
- [ ] Upload: Prevents custom config with path matching library definition
- [ ] Upload: Requires template selection in template mode
- [ ] Upload: Requires name and path in custom mode
- [ ] Upload: Validates library path matches template path
- [ ] PUT endpoint: Rejects library mappings with path field
- [ ] PUT endpoint: Rejects custom mappings without path or label
- [ ] PUT endpoint: Validates definitionId references exist for library type

---

## Implementation Order

1. **Phase 1: Type System** (Foundation)
   - Update backend types (`backend/src/types/plugins.ts`)
   - Update backend logic (`buildPluginConfigViews`, PUT endpoint, etc.)
   - Update plugin routes (`backend/src/routes/plugins.ts`)
   - Update project scanner (`backend/src/services/projectScanner.ts`)

2. **Phase 2: Fix Deletion** (Critical Bug)
   - Update delete endpoint (`backend/src/routes/projects.ts`)
   - Add imports (`unlink`, `existsSync`, `getDevDataPaths`)
   - Test deletion from all locations (uploads, project dir, dev dirs)

3. **Phase 3: UI Refactor** (User-Facing)
   - Update frontend types (`frontend/src/lib/api.ts`)
   - Refactor upload form (`frontend/src/pages/ProjectDetail.tsx`)
   - Update config display (remove requirement/missing badges)
   - Update CustomPathModal component
   - Update PluginLibrary component

4. **Phase 4: Validation** (Polish)
   - Add path conflict helper function
   - Update upload endpoint validation
   - Add comprehensive error messages
   - Test all edge cases

---

## Breaking Changes

- **API**: `ProjectPluginConfigMapping` structure changes (discriminated union with `type` field)
- **API**: `requirement` field removed from all config-related endpoints
- **Data**: Existing `configMappings` are automatically migrated on access (runtime conversion)
- **Data**: `requirement` fields removed from `plugins.json` and `projects.json` (ignored if present)

## Backward Compatibility

- **Automatic Runtime Migration**: Old format mappings (without `type` field) are automatically detected and converted when projects are loaded:
  - If `definitionId` matches a library definition → treated as `type: 'library'`
  - Otherwise → treated as `type: 'custom'` with `customId` derived from `definitionId`
  - Migration happens transparently in `buildPluginConfigViews` - no manual steps required
- **No Data Loss**: All existing fields are preserved (notes, label, path for custom)
- **View Compatibility**: `source` field in views is kept for backward compatibility (same value as `type`)
- **API Compatibility**: Old API requests without `type` field will be rejected with clear error messages directing users to use the new format
- **Requirement Field**: The `requirement` field is ignored if present in old data (no migration needed)

## Additional Considerations

### Error Messages
- Update all error messages to reference "Config Template" instead of "Library Config" for user-facing text
- Update all error messages to reference "Custom Config" instead of "Custom Mapping"
- Provide clear guidance when validation fails (e.g., "Use Config Template mode for this path")

### Testing Edge Cases
- Custom config with path matching library definition (should be prevented)
- Library config with path override attempt (should be rejected)
- Deletion of file that exists in both uploads and project directory (should delete from both)
- Deletion of file that doesn't exist (should still remove metadata)

### Performance
- Path conflict checking should use early exit when conflict is found

---

## Spec Improvements & Clarifications

This specification has been enhanced with the following improvements:

1. **Code Examples:**
   - Improved `buildPluginConfigViews` logic with better migration handling
   - Added missing imports and function references

2. **Clarifications:**
   - Added notes about existing functions (`sanitizeRelativePath`, `getDevDataPaths`)
   - Clarified backward compatibility behavior (automatic runtime migration)
   - Added edge case considerations
   - Enhanced testing checklist with additional scenarios

4. **Implementation Details:**
   - Expanded implementation order with specific file paths
   - Added error message guidance
   - Included performance considerations
   - Added validation requirements for all endpoints

5. **Documentation:**
   - Added "Additional Considerations" section
   - Improved code comments and explanations
   - Simplified migration approach (runtime conversion instead of script)
