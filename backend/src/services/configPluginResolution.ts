import type { StoredProject } from "../types/storage";
import { findStoredPlugin } from "../storage/pluginsStore";
import { inferPluginIdFromWorkspacePath } from "./workspacePluginFiles";
import type { ConfigFileSummary } from "./configUploads";

export function findPluginMappingForPath(
  project: StoredProject,
  path: string,
): { pluginId: string; definitionId?: string } | undefined {
  for (const plugin of project.plugins ?? []) {
    for (const mapping of plugin.configMappings ?? []) {
      if ("type" in mapping) {
        if (mapping.type === "custom" && mapping.path === path) {
          return { pluginId: plugin.id, definitionId: mapping.customId };
        } else if (mapping.type === "library") {
          continue;
        }
      } else {
        const oldMapping = mapping as { path?: string; definitionId?: string };
        if (oldMapping.path === path) {
          return { pluginId: plugin.id, definitionId: oldMapping.definitionId };
        }
      }
    }
  }
  return undefined;
}

export async function findLibraryDefinitionForPath(
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

/**
 * Resolves which project plugin "owns" a config path (UI grouping, promote eligibility).
 * Handles e.g. plugins/GriefPreventionData/... when the project lists plugin id GriefPrevention.
 */
export async function resolvePluginIdForConfigSummary(
  project: StoredProject,
  summary: Pick<ConfigFileSummary, "path" | "pluginId">,
): Promise<string | undefined> {
  if (summary.pluginId) {
    return summary.pluginId;
  }
  const mapped = findPluginMappingForPath(project, summary.path);
  if (mapped?.pluginId) {
    return mapped.pluginId;
  }
  const fromFolder = inferPluginIdFromWorkspacePath(project, summary.path);
  if (fromFolder) {
    return fromFolder;
  }
  const lib = await findLibraryDefinitionForPath(project, summary.path);
  if (lib?.pluginId) {
    return lib.pluginId;
  }
  const m = summary.path.match(/^plugins\/([^/]+)/);
  if (!m) {
    return undefined;
  }
  const folder = m[1];
  const dataSuffix = /^(.+)data$/i.exec(folder);
  if (dataSuffix?.[1]) {
    const base = dataSuffix[1];
    const plugin = project.plugins?.find(
      (p) => p.id && p.id.toLowerCase() === base.toLowerCase(),
    );
    if (plugin) {
      return plugin.id;
    }
  }
  return undefined;
}
