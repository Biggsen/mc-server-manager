export type PluginProvider = "hangar" | "modrinth" | "spiget" | "github" | "custom";

export interface PluginSourceReference {
  provider: PluginProvider;
  slug: string;
  displayName?: string;
  projectUrl?: string;
  versionId?: string;
  downloadUrl?: string;
  loader?: string;
  minecraftVersion?: string;
  minecraftVersionMin?: string;
  minecraftVersionMax?: string;
  uploadPath?: string;
  sha256?: string;
  cachePath?: string;
}

export interface PluginConfigDefinition {
  id: string;
  path: string;
  label?: string;
  description?: string;
  tags?: string[];
}

export type ProjectPluginConfigMapping =
  | {
      type: 'library';
      definitionId: string;  // References PluginConfigDefinition.id
      notes?: string;
    }
  | {
      type: 'custom';
      customId: string;  // e.g., "custom/crazycrates-regioncrate"
      label: string;  // Required
      path: string;  // Required
      notes?: string;
    };

export interface ProjectPlugin {
  id: string;
  version: string;
  sha256?: string;
  provider?: PluginProvider;
  source?: PluginSourceReference;
  minecraftVersionMin?: string;
  minecraftVersionMax?: string;
  cachePath?: string;
  configMappings?: ProjectPluginConfigMapping[];
  /** If false, plugin is excluded from builds and manifest. Default true. */
  enabled?: boolean;
}

/** Returns only plugins that are enabled (enabled !== false). */
export function getEnabledPlugins(plugins: ProjectPlugin[] | undefined): ProjectPlugin[] {
  return (plugins ?? []).filter((p) => p.enabled !== false);
}

export interface StoredPluginRecord {
  id: string;
  version: string;
  provider?: PluginProvider;
  source?: PluginSourceReference;
  sha256?: string;
  minecraftVersionMin?: string;
  minecraftVersionMax?: string;
  cachePath?: string;
  artifactFileName?: string;
  cachedAt?: string;
  lastUsedAt?: string;
  /** Directory name under plugins/ for this plugin's data (omit = same as id). */
  dataFolder?: string;
  createdAt: string;
  updatedAt: string;
  configDefinitions?: PluginConfigDefinition[];
}

