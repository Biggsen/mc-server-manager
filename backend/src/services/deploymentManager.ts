import type { DeploymentTarget } from "../types/deployment";
import type { BuildJob } from "../types/build";

export interface DeploymentResult {
  targetId: string;
  buildId: string;
  status: "queued" | "skipped";
  message?: string;
}

export async function publishBuildToTarget(
  target: DeploymentTarget,
  build: BuildJob,
): Promise<DeploymentResult> {
  // Placeholder implementation: actual deployment will be implemented later.
  console.info(
    `[deploy] (stub) target=${target.id}/${target.type} build=${build.id} artifact=${build.artifactPath}`,
  );

  return {
    targetId: target.id,
    buildId: build.id,
    status: "queued",
    message: "Deployment queued (stub implementation).",
  };
}


