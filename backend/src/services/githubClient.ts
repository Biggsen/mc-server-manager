import { Octokit } from "@octokit/rest";
import { throttling } from "@octokit/plugin-throttling";
import type { Request } from "express";

const ThrottledOctokit = Octokit.plugin(throttling as never);

export function getOctokitForRequest(req: Request): Octokit {
  const accessToken = req.session.github?.accessToken;
  if (!accessToken) {
    throw new Error("GitHub session not available");
  }

  return createOctokit(accessToken);
}

export function getOctokitWithToken(token: string): Octokit {
  return createOctokit(token);
}

function createOctokit(token: string): Octokit {
  return new ThrottledOctokit({
    auth: token,
    userAgent: "mc-server-manager/0.1",
    throttle: {
      onRateLimit: (retryAfter: number, options: any, octokit: any) => {
        console.warn(`Request quota exhausted for request ${options.method} ${options.url}`);
        if (options.request.retryCount === 0) {
          console.log(`Retrying after ${retryAfter} seconds`);
          return true;
        }
        return false;
      },
      onSecondaryRateLimit: (retryAfter: number, options: any, octokit: any) => {
        console.warn(`Secondary rate limit hit for request ${options.method} ${options.url}`);
        return false;
      },
    },
  });
}

export interface CommitFileContent {
  content: string;
  encoding?: "utf-8" | "base64";
}

export interface CommitFilesOptions {
  owner: string;
  repo: string;
  branch?: string;
  message: string;
  files: Record<string, CommitFileContent | string>;
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
    Object.entries(options.files).map(async ([path, value]) => {
      const payload: CommitFileContent =
        typeof value === "string"
          ? { content: value, encoding: "utf-8" }
          : { content: value.content, encoding: value.encoding ?? "utf-8" };

      const blob = await octokit.git.createBlob({
        owner: options.owner,
        repo: options.repo,
        content: payload.content,
        encoding: payload.encoding,
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

