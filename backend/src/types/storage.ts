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
  plugins?: Array<{ id: string; version: string; sha256?: string }>;
  configs?: Array<{ path: string; sha256?: string }>;
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

