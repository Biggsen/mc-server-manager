export type BuildStatus = "pending" | "running" | "succeeded" | "failed";

export interface BuildJob {
  id: string;
  projectId: string;
  status: BuildStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  manifestBuildId?: string;
  manifestPath?: string;
  artifactPath?: string;
  artifactSha?: string;
  error?: string;
}

