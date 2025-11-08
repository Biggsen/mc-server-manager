import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import type { Request } from "express";

const ThrottledOctokit = Octokit.plugin(throttling);

export function getOctokitForRequest(req: Request): Octokit {
  const accessToken = req.session.github?.accessToken;
  if (!accessToken) {
    throw new Error("GitHub session not available");
  }

  return new ThrottledOctokit({
    auth: accessToken,
    userAgent: "mc-server-manager/0.1",
    throttle: {
      onRateLimit: (retryAfter, options, octokit) => {
        console.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
        if (options.request.retryCount === 0) {
          console.log(`Retrying after ${retryAfter} seconds`);
          return true;
        }
        return false;
      },
      onSecondaryRateLimit: (retryAfter, options, octokit) => {
        console.warn(`Secondary rate limit hit for request ${options.method} ${options.url}`);
        return false;
      },
    },
  });
}

export interface CommitFilesOptions {
  owner: string;
  repo: string;
  branch?: string;
  message: string;
  files: Record<string, string>;
}

export async function commitFiles(
  octokit: Octokit,
  options: CommitFilesOptions,
): Promise<{ commitSha: string }> {
  const branchRef = options.branch ?? "main";

  const { data: refData } = await octokit.git.getRef({
    owner: options.owner,
    repo: options.repo,
    ref: `heads/${branchRef}`,
  });

  const baseCommitSha = refData.object.sha;

  const treeItems = await Promise.all(
    Object.entries(options.files).map(async ([path, content]) => {
      const blob = await octokit.git.createBlob({
        owner: options.owner,
        repo: options.repo,
        content,
        encoding: "utf-8",
      });
      return {
        path,
        mode: "100644",
        type: "blob",
        sha: blob.data.sha,
      } as const;
    }),
  );

  const { data: baseCommit } = await octokit.git.getCommit({
    owner: options.owner,
    repo: options.repo,
    commit_sha: baseCommitSha,
  });

  const { data: tree } = await octokit.git.createTree({
    owner: options.owner,
    repo: options.repo,
    tree: treeItems,
    base_tree: baseCommit.tree.sha,
  });

  const { data: newCommit } = await octokit.git.createCommit({
    owner: options.owner,
    repo: options.repo,
    message: options.message,
    tree: tree.sha,
    parents: [baseCommitSha],
  });

  await octokit.git.updateRef({
    owner: options.owner,
    repo: options.repo,
    ref: `heads/${branchRef}`,
    sha: newCommit.sha,
  });

  return { commitSha: newCommit.sha };
}

