import type { ManifestMetadata, StoredProject } from "./storage";

export interface ProjectSummary {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: "paper" | "purpur" | string;
  description?: string;
  updatedAt: string;
  source?: "created" | "imported";
  manifest?: ManifestMetadata;
  plugins?: StoredProject["plugins"];
  configs?: StoredProject["configs"];
}

