import type { ProjectPlugin } from "./plugins";

export interface StoredProjectConfigEntry {
  path: string;
  sha256?: string;
  pluginId?: string;
  definitionId?: string;
}

export interface RepoMetadata {
  id?: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
  defaultBranch: string;
}

export interface StoredProject {
  id: string;
  name: string;
  description?: string;
  minecraftVersion: string;
  loader: "paper" | "purpur" | string;
  source: "created" | "imported";
  repoUrl?: string;
  defaultBranch?: string;
  profilePath?: string;
  repo?: RepoMetadata;
  plugins?: ProjectPlugin[];
  configs?: StoredProjectConfigEntry[];
  manifest?: ManifestMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectsSnapshot {
  projects: StoredProject[];
}

export interface ManifestMetadata {
  lastBuildId: string;
  manifestPath: string;
  generatedAt: string;
  commitSha?: string;
}

