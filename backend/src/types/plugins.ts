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
}

export interface ProjectPlugin {
  id: string;
  version: string;
  sha256?: string;
  provider?: PluginProvider;
  source?: PluginSourceReference;
  minecraftVersionMin?: string;
  minecraftVersionMax?: string;
}

export interface StoredPluginRecord {
  id: string;
  version: string;
  provider?: PluginProvider;
  source?: PluginSourceReference;
  sha256?: string;
  minecraftVersionMin?: string;
  minecraftVersionMax?: string;
  createdAt: string;
  updatedAt: string;
}


