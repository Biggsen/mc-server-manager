import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getDataRoot } from "../config";
import type { ProjectPluginConfigMapping, PluginConfigDefinition } from "../types/plugins";

interface OldConfigMapping {
  definitionId: string;
  path?: string;
  label?: string;
  notes?: string;
  requirement?: string;
}

interface ProjectsSnapshot {
  projects: Array<{
    id: string;
    plugins?: Array<{
      id: string;
      version: string;
      configMappings?: Array<OldConfigMapping | ProjectPluginConfigMapping>;
    }>;
  }>;
}

interface PluginsSnapshot {
  plugins: Array<{
    id: string;
    version: string;
    configDefinitions?: PluginConfigDefinition[];
  }>;
}

function isNewFormat(mapping: OldConfigMapping | ProjectPluginConfigMapping): mapping is ProjectPluginConfigMapping {
  return 'type' in mapping && (mapping.type === 'library' || mapping.type === 'custom');
}

function migrateMapping(
  mapping: OldConfigMapping,
  libraryDefinitions: PluginConfigDefinition[]
): ProjectPluginConfigMapping | null {
  // Already migrated
  if (isNewFormat(mapping)) {
    return mapping;
  }

  const definitionId = mapping.definitionId;
  const libraryDef = libraryDefinitions.find(d => d.id === definitionId);

  if (libraryDef) {
    // Library config
    return {
      type: 'library',
      definitionId,
      notes: mapping.notes,
    };
  } else {
    // Custom config
    if (!mapping.path) {
      console.warn(`Skipping custom config without path: ${definitionId}`);
      return null;
    }
    
    const customId = definitionId.startsWith('custom/')
      ? definitionId
      : `custom/${definitionId}`;
    
    return {
      type: 'custom',
      customId,
      label: mapping.label || customId,
      path: mapping.path,
      notes: mapping.notes,
    };
  }
}

async function migrate() {
  const dataRoot = getDataRoot();
  const projectsPath = join(dataRoot, "data", "projects.json");
  const pluginsPath = join(dataRoot, "data", "plugins.json");

  console.log("Loading projects.json...");
  const projectsContent = await readFile(projectsPath, "utf-8");
  const projects: ProjectsSnapshot = JSON.parse(projectsContent);

  console.log("Loading plugins.json...");
  const pluginsContent = await readFile(pluginsPath, "utf-8");
  const pluginsSnapshot: PluginsSnapshot = JSON.parse(pluginsContent);

  // Build a map of plugin definitions: pluginId:version -> definitions
  const definitionsMap = new Map<string, PluginConfigDefinition[]>();
  for (const plugin of pluginsSnapshot.plugins) {
    const key = `${plugin.id}:${plugin.version}`;
    definitionsMap.set(key, plugin.configDefinitions ?? []);
  }

  let migratedCount = 0;
  let totalCount = 0;

  console.log("Migrating configMappings...");
  for (const project of projects.projects) {
    if (!project.plugins) continue;

    for (const plugin of project.plugins) {
      if (!plugin.configMappings || plugin.configMappings.length === 0) continue;

      const key = `${plugin.id}:${plugin.version}`;
      const libraryDefinitions = definitionsMap.get(key) ?? [];

      const migrated: ProjectPluginConfigMapping[] = [];
      for (const mapping of plugin.configMappings) {
        totalCount++;
        
        if (isNewFormat(mapping)) {
          // Already migrated, keep as-is
          migrated.push(mapping);
        } else {
          // Migrate old format
          const migratedMapping = migrateMapping(mapping as OldConfigMapping, libraryDefinitions);
          if (migratedMapping) {
            migrated.push(migratedMapping);
            migratedCount++;
          }
        }
      }

      plugin.configMappings = migrated;
    }
  }

  console.log(`Migrated ${migratedCount} of ${totalCount} configMappings`);

  console.log("Writing updated projects.json...");
  await writeFile(projectsPath, JSON.stringify(projects, null, 2), "utf-8");

  console.log("Migration complete!");
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
