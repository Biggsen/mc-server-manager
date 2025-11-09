export type RunStatus =
  | "pending"
  | "running"
  | "stopping"
  | "stopped"
  | "succeeded"
  | "failed";

export type RunLogStream = "stdout" | "stderr" | "system";

export interface RunLogEntry {
  timestamp: string;
  stream: RunLogStream;
  message: string;
}

export interface RunJob {
  id: string;
  projectId: string;
  buildId: string;
  artifactPath: string;
  status: RunStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  logs: RunLogEntry[];
  containerName?: string;
  port?: number;
  workspacePath?: string;
}


