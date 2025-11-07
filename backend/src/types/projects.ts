export interface ProjectSummary {
  id: string;
  name: string;
  minecraftVersion: string;
  loader: "paper" | "purpur" | string;
  description?: string;
  updatedAt: string;
  source?: "created" | "imported";
}

