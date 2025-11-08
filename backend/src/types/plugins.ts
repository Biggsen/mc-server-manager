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
}

export interface ProjectPlugin {
  id: string;
  version: string;
  sha256?: string;
  provider?: PluginProvider;
  source?: PluginSourceReference;
}


