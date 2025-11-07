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
  createdAt: string;
  updatedAt: string;
}

export interface ProjectsSnapshot {
  projects: StoredProject[];
}

