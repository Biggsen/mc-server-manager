# Config System Refactor - Detailed Specification

## Overview
Comprehensive refactor of the config system to:
1. Clarify library configs vs custom configs using discriminated union
2. Remove requirement field (contextual, not inherent to configs)
3. Fix deletion issue (configs in project directory not being found)
4. Improve UI/UX with proper terminology (Config Template vs Custom Config)
5. Add migration support (auto-detect custom→library conflicts)

## Goals
- **Type Safety**: Discriminated union makes library vs custom distinction explicit
- **Simplicity**: Remove requirement field that adds no functional value
- **Reliability**: Fix deletion to work from all storage locations
- **Clarity**: Better terminology and UI flow
- **Migration**: Smooth transition when library definitions become available

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

**New logic:**
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
  if (definitionMap.has(mapping.definitionId)) {
    continue;  // Already handled as library config
  }
  // This is a custom config
  if (mapping.type !== 'custom') {
    // Migration: old format without type
    // Assume custom if definitionId doesn't match library
    continue;  // Or handle migration
  }
  const resolvedPath = mapping.path;  // Required for custom
  if (!resolvedPath) {
    continue;  // Invalid custom config
  }
  const uploaded = resolveUpload(mapping.customId, resolvedPath);
  if (uploaded) {
    matchedSummaries.add(uploaded);
  }
  views.push({
    id: mapping.customId,
    type: 'custom',
    source: 'custom',
    label: mapping.label,  // Required for custom
    description: undefined,
    tags: undefined,
    defaultPath: resolvedPath,
    resolvedPath,
    notes: mapping.notes,
    mapping,
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
const resolvedPath = mapping.path ?? "";
if (!resolvedPath) {
  continue;  // Invalid custom config
}
```

---

## Part 2: Fix Config Deletion Issue

### 2.1 Update Delete Endpoint (`backend/src/routes/projects.ts`)

**Current (lines ~1681-1712):**
- Only checks `config/uploads/`
- Returns 404 if file not found in uploads

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
```

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

## Part 4: Migration Detection & User Confirmation

### 4.1 Backend - Detection Function (`backend/src/routes/projects.ts`)

```typescript
function detectCustomToLibraryConflicts(
  project: StoredProject,
  plugin: ProjectPlugin,
  libraryDefinitions: PluginConfigDefinition[],
): Array<{ custom: ProjectPluginConfigMapping, library: PluginConfigDefinition }> {
  const conflicts: Array<{ custom: ProjectPluginConfigMapping, library: PluginConfigDefinition }> = [];
  
  const customConfigs = (plugin.configMappings ?? []).filter(
    (m) => m.type === 'custom' || (!m.type && !libraryDefinitions.some(d => d.id === m.definitionId))
  );
  
  for (const custom of customConfigs) {
    if (custom.type !== 'custom' && !custom.path) continue;
    
    const customPath = custom.path;
    if (!customPath) continue;
    
    // Find library definition with matching path
    for (const libraryDef of libraryDefinitions) {
      if (libraryDef.path === customPath) {
        conflicts.push({ custom, library: libraryDef });
        break;
      }
    }
  }
  
  return conflicts;
}
```

### 4.2 Backend - Migration Endpoint

```typescript
router.get("/:id/plugins/:pluginId/configs/migration-opportunities", async (req: Request, res: Response) => {
  try {
    const { id, pluginId } = req.params;
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    const plugin = project.plugins?.find((p) => p.id === pluginId);
    if (!plugin) {
      res.status(404).json({ error: "Plugin not found" });
      return;
    }
    
    const stored = plugin.version ? await findStoredPlugin(plugin.id, plugin.version) : undefined;
    const libraryDefinitions = stored?.configDefinitions ?? [];
    
    const conflicts = detectCustomToLibraryConflicts(project, plugin, libraryDefinitions);
    
    res.json({
      opportunities: conflicts.map(({ custom, library }) => ({
        custom: {
          customId: custom.type === 'custom' ? custom.customId : custom.definitionId,
          label: custom.type === 'custom' ? custom.label : custom.definitionId,
          path: custom.path,
          notes: custom.notes,
        },
        library: {
          id: library.id,
          label: library.label,
          path: library.path,
          description: library.description,
        },
      })),
    });
  } catch (error) {
    console.error("Failed to detect migration opportunities", error);
    res.status(500).json({ error: "Failed to detect migration opportunities" });
  }
});

router.post("/:id/plugins/:pluginId/configs/migrate", async (req: Request, res: Response) => {
  try {
    const { id, pluginId } = req.params;
    const { customId, definitionId } = req.body ?? {};
    
    if (typeof customId !== "string" || typeof definitionId !== "string") {
      res.status(400).json({ error: "customId and definitionId are required" });
      return;
    }
    
    const project = await findProject(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }
    
    const plugin = project.plugins?.find((p) => p.id === pluginId);
    if (!plugin) {
      res.status(404).json({ error: "Plugin not found" });
      return;
    }
    
    const stored = plugin.version ? await findStoredPlugin(plugin.id, plugin.version) : undefined;
    const libraryDefinitions = stored?.configDefinitions ?? [];
    const libraryDef = libraryDefinitions.find((d) => d.id === definitionId);
    if (!libraryDef) {
      res.status(404).json({ error: "Library definition not found" });
      return;
    }
    
    const mappings = plugin.configMappings ?? [];
    const customMapping = mappings.find(
      (m) => (m.type === 'custom' && m.customId === customId) || 
             (!m.type && m.definitionId === customId)
    );
    
    if (!customMapping) {
      res.status(404).json({ error: "Custom config not found" });
      return;
    }
    
    // Validate paths match
    const customPath = customMapping.type === 'custom' ? customMapping.path : customMapping.path;
    if (customPath !== libraryDef.path) {
      res.status(400).json({ error: "Paths do not match" });
      return;
    }
    
    // Convert to library mapping
    const updatedMappings = mappings.map((m) => {
      if ((m.type === 'custom' && m.customId === customId) || 
          (!m.type && m.definitionId === customId)) {
        return {
          type: 'library' as const,
          definitionId: definitionId,
          notes: m.notes,
        };
      }
      return m;
    });
    
    // Update project
    const updatedPlugin: ProjectPlugin = {
      ...plugin,
      configMappings: updatedMappings,
    };
    
    await upsertProjectPlugin(id, updatedPlugin);
    
    // Update file metadata
    const configs = project.configs ?? [];
    const updatedConfigs = configs.map((config) => {
      if (config.path === customPath && config.pluginId === pluginId) {
        return {
          ...config,
          definitionId: definitionId,
        };
      }
      return config;
    });
    
    await setProjectAssets(id, { configs: updatedConfigs });
    
    // Return updated configs view
    const refreshed = await findProject(id);
    if (!refreshed) {
      res.status(500).json({ error: "Failed to refresh project" });
      return;
    }
    
    const refreshedPlugin = refreshed.plugins?.find((p) => p.id === pluginId);
    if (!refreshedPlugin) {
      res.status(500).json({ error: "Failed to find refreshed plugin" });
      return;
    }
    
    const { definitions } = await buildPluginConfigViews(
      pluginId,
      refreshedPlugin,
      libraryDefinitions,
      await listUploadedConfigFiles(refreshed),
    );
    
    res.json({ definitions });
  } catch (error) {
    console.error("Failed to migrate config", error);
    res.status(500).json({ error: "Failed to migrate config" });
  }
});
```

### 4.3 Frontend - Migration UI (`frontend/src/pages/ProjectDetail.tsx`)

```typescript
// Add state
const [migrationOpportunities, setMigrationOpportunities] = useState<Array<{
  custom: { customId: string; label: string; path: string; notes?: string }
  library: { id: string; label?: string; path: string; description?: string }
}>>([])

// Detect on plugin config load
useEffect(() => {
  if (!id || !plugin.id) return
  
  const checkMigrations = async () => {
    try {
      const opportunities = await fetchMigrationOpportunities(id, plugin.id)
      setMigrationOpportunities(opportunities)
    } catch {
      // Ignore errors
    }
  }
  
  void checkMigrations()
}, [id, plugin.id, pluginDefinitions])

// Show migration banner
{migrationOpportunities.length > 0 && (
  <Alert color="blue" title="Library Templates Available">
    <Stack gap="xs">
      {migrationOpportunities.map((opp) => (
        <Group key={opp.custom.customId} justify="space-between">
          <Stack gap={2}>
            <Text size="sm">
              Your custom config "{opp.custom.label}" matches library template "{opp.library.label || opp.library.id}"
            </Text>
            <Text size="xs" c="dimmed">
              Path: {opp.custom.path}
            </Text>
          </Stack>
          <Group>
            <Button
              size="xs"
              variant="light"
              onClick={async () => {
                try {
                  await migrateCustomToLibrary(id, plugin.id, opp.custom.customId, opp.library.id)
                  toast({ title: 'Migrated to template', variant: 'success' })
                  setMigrationOpportunities((prev) => prev.filter((o) => o.custom.customId !== opp.custom.customId))
                  // Refresh plugin configs
                } catch (err) {
                  toast({ title: 'Migration failed', description: err.message, variant: 'danger' })
                }
              }}
            >
              Convert to Template
            </Button>
            <Button
              size="xs"
              variant="subtle"
              onClick={() => {
                setMigrationOpportunities((prev) => prev.filter((o) => o.custom.customId !== opp.custom.customId))
              }}
            >
              Keep as Custom
            </Button>
          </Group>
        </Group>
      ))}
    </Stack>
  </Alert>
)}
```

### 4.4 Frontend - Migration API (`frontend/src/lib/api.ts`)

```typescript
export async function fetchMigrationOpportunities(
  projectId: string,
  pluginId: string,
): Promise<Array<{
  custom: { customId: string; label: string; path: string; notes?: string }
  library: { id: string; label?: string; path: string; description?: string }
}>> {
  const data = await request<{ opportunities: Array<...> }>(
    `/projects/${projectId}/plugins/${pluginId}/configs/migration-opportunities`
  )
  return data.opportunities
}

export async function migrateCustomToLibrary(
  projectId: string,
  pluginId: string,
  customId: string,
  definitionId: string,
): Promise<ProjectPluginConfigsResponse> {
  const data = await request<ProjectPluginConfigsResponse>(
    `/projects/${projectId}/plugins/${pluginId}/configs/migrate`,
    {
      method: 'POST',
      body: JSON.stringify({ customId, definitionId }),
      headers: { 'Content-Type': 'application/json' },
    }
  )
  emitProjectsUpdated()
  return data
}
```

---

## Part 5: Validation & Path Conflict Prevention

### 5.1 Upload Validation (`backend/src/routes/projects.ts`)

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

// Update upload endpoint
router.post("/:id/configs/upload", ...) {
  // ... existing validation ...
  
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
  
  // ... rest of upload logic ...
}
```

---

## Part 6: Data Migration Script

### 6.1 Migration Script (`scripts/migrate-config-system.ts`)

**Important:** This script uses the same path resolution logic as the app, supporting both development and production (Electron/userData) environments.

```typescript
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';

// Replicate getDataRoot logic from backend/src/config.ts
// This ensures the script works in both dev and production (Electron) environments
function getDataRoot(): string {
  const electronMode = process.env.ELECTRON_MODE === 'true';
  const userDataPath = process.env.USER_DATA_PATH;
  
  if (electronMode && userDataPath) {
    return userDataPath;
  }
  
  return process.cwd();
}

function getPluginsPath(): string {
  return join(getDataRoot(), 'data', 'plugins.json');
}

function getProjectsPath(): string {
  return join(getDataRoot(), 'data', 'projects.json');
}

interface OldProjectPluginConfigMapping {
  definitionId: string;
  label?: string;
  path?: string;
  requirement?: string;
  notes?: string;
}

interface NewProjectPluginConfigMapping {
  type: 'library' | 'custom';
  definitionId?: string;
  customId?: string;
  label?: string;
  path?: string;
  notes?: string;
}

async function migrateProjects() {
  const projectsPath = getProjectsPath();
  const pluginsPath = getPluginsPath();
  
  console.log('Data root:', getDataRoot());
  console.log('Projects path:', projectsPath);
  console.log('Plugins path:', pluginsPath);
  
  // Load data
  const projectsData = JSON.parse(await readFile(projectsPath, 'utf-8'));
  const pluginsData = JSON.parse(await readFile(pluginsPath, 'utf-8'));
  
  // Create plugin definition map
  const pluginDefMap = new Map<string, Map<string, { id: string; path: string }>>();
  for (const plugin of pluginsData.plugins || []) {
    const defMap = new Map();
    for (const def of plugin.configDefinitions || []) {
      defMap.set(def.id, { id: def.id, path: def.path });
    }
    pluginDefMap.set(`${plugin.id}:${plugin.version}`, defMap);
  }
  
  // Migrate projects
  let migrated = 0;
  for (const project of projectsData.projects || []) {
    for (const plugin of project.plugins || []) {
      if (!plugin.configMappings) continue;
      
      const key = `${plugin.id}:${plugin.version}`;
      const defMap = pluginDefMap.get(key);
      
      const newMappings: NewProjectPluginConfigMapping[] = [];
      
      for (const oldMapping of plugin.configMappings) {
        const isLibrary = defMap?.has(oldMapping.definitionId);
        
        if (isLibrary) {
          // Library mapping
          newMappings.push({
            type: 'library',
            definitionId: oldMapping.definitionId,
            notes: oldMapping.notes,
            // Remove path and requirement
          });
        } else {
          // Custom mapping
          newMappings.push({
            type: 'custom',
            customId: oldMapping.definitionId.startsWith('custom/')
              ? oldMapping.definitionId
              : `custom/${oldMapping.definitionId}`,
            label: oldMapping.label || oldMapping.definitionId,
            path: oldMapping.path || '',
            notes: oldMapping.notes,
            // Remove requirement
          });
        }
      }
      
      plugin.configMappings = newMappings;
      migrated++;
    }
  }
  
  // Remove requirement from plugin definitions
  for (const plugin of pluginsData.plugins || []) {
    for (const def of plugin.configDefinitions || []) {
      delete def.requirement;
    }
  }
  
  // Backup and write
  await writeFile(projectsPath + '.backup', JSON.stringify(projectsData, null, 2));
  await writeFile(pluginsPath + '.backup', JSON.stringify(pluginsData, null, 2));
  
  await writeFile(projectsPath, JSON.stringify(projectsData, null, 2));
  await writeFile(pluginsPath, JSON.stringify(pluginsData, null, 2));
  
  console.log(`Migrated ${migrated} plugin config mappings`);
  console.log('Backups created:', projectsPath + '.backup', pluginsPath + '.backup');
}

migrateProjects().catch(console.error);
```

#### Running the Migration Script

**Development Mode:**
```bash
# From project root
npx tsx scripts/migrate-config-system.ts
```

**Production/Electron Mode:**
The script will automatically detect Electron mode if `ELECTRON_MODE` and `USER_DATA_PATH` environment variables are set. These are typically set by the Electron main process, but you can also run manually:

```bash
# Set environment variables (adjust userData path for your system)
export ELECTRON_MODE=true
export USER_DATA_PATH="/path/to/userData"  # e.g., ~/Library/Application Support/mc-server-manager
npx tsx scripts/migrate-config-system.ts
```

**Windows (PowerShell):**
```powershell
$env:ELECTRON_MODE="true"
$env:USER_DATA_PATH="C:\Users\Username\AppData\Roaming\mc-server-manager"
npx tsx scripts/migrate-config-system.ts
```

**Note:** The script creates backups (`.backup` files) before modifying data. Always verify backups before proceeding.

---

## Part 7: Testing Checklist

### 7.1 Type System
- [ ] Library config: type='library', no path field, definitionId required
- [ ] Custom config: type='custom', path and label required, customId generated
- [ ] Backward compatibility: old format without type field loads correctly
- [ ] Path resolution: library always uses definition.path, custom uses mapping.path

### 7.2 Deletion
- [ ] Delete from config/uploads/ works
- [ ] Delete from project directory works
- [ ] Delete from dev directory works
- [ ] Delete when file doesn't exist (metadata only) works
- [ ] Metadata always removed

### 7.3 UI
- [ ] Upload form: Template mode shows template dropdown, path read-only
- [ ] Upload form: Custom mode shows name + path inputs
- [ ] Config display: Shows unified list with Template/Custom badges
- [ ] No requirement badges shown
- [ ] No missing warnings shown

### 7.4 Migration
- [ ] Detection finds custom configs matching library definitions
- [ ] Migration converts custom to library correctly
- [ ] Migration preserves notes
- [ ] Migration updates file metadata
- [ ] UI shows migration prompt
- [ ] Migration action works

### 7.5 Validation
- [ ] Upload: Prevents custom config with path matching library definition
- [ ] Upload: Requires template selection in template mode
- [ ] Upload: Requires name and path in custom mode
- [ ] Upload: Validates library path matches template path

---

## Implementation Order

1. **Phase 1: Type System + Data Migration** (Foundation)
   - Update types
   - Create migration script
   - Run migration
   - Update backend logic

2. **Phase 2: Fix Deletion** (Critical Bug)
   - Update delete endpoint
   - Test thoroughly

3. **Phase 3: UI Refactor** (User-Facing)
   - Update frontend types
   - Refactor upload form
   - Update config display
   - Remove requirement UI

4. **Phase 4: Migration Support** (Enhancement)
   - Detection logic
   - Migration endpoints
   - UI prompts

5. **Phase 5: Validation** (Polish)
   - Path conflict prevention
   - Upload validation
   - Edge case handling

---

## Breaking Changes

- **API**: `ProjectPluginConfigMapping` structure changes (discriminated union with `type` field)
- **API**: `requirement` field removed from all config-related endpoints
- **Data**: Existing `configMappings` need migration (script provided)
- **Data**: `requirement` fields removed from `plugins.json` and `projects.json`

## Backward Compatibility

- Migration script handles existing data
- Old format can be detected and converted automatically
- No data loss during migration
- Consider keeping `source` field in views for backward compat during transition
