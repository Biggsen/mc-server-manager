export interface InitCommand {
  type?: "gamerule" | "plugin" | "custom";
  command: string;
  plugin?: string;
  description?: string;
}

export interface InitializationMarker {
  initializedAt: string;
  commands: string[];
  projectId: string;
  buildId: string;
}
