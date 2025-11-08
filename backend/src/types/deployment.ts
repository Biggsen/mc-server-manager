export type DeploymentType = "folder" | "sftp";

export interface DeploymentTargetBase {
  id: string;
  name: string;
  type: DeploymentType;
  createdAt: string;
  updatedAt: string;
  notes?: string;
}

export interface FolderDeploymentTarget extends DeploymentTargetBase {
  type: "folder";
  path: string;
}

export interface SftpDeploymentTarget extends DeploymentTargetBase {
  type: "sftp";
  host: string;
  port: number;
  username: string;
  remotePath: string;
}

export type DeploymentTarget = FolderDeploymentTarget | SftpDeploymentTarget;

export interface DeploymentSnapshot {
  targets: DeploymentTarget[];
}


