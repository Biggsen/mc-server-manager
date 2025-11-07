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
}

