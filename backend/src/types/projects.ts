import type { ManifestMetadata, RepoMetadata, StoredProject } from "./storage";
import type { ProjectPlugin } from "./plugins";

export interface ProjectSummary {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: "paper" | "purpur" | string;
  description?: string;
  updatedAt: string;
  source?: "created" | "imported";
  manifest?: ManifestMetadata;
  plugins?: ProjectPlugin[];
  configs?: StoredProject["configs"];
  repo?: RepoMetadata;
}

