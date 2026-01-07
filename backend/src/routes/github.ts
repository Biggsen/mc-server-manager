import type { Request, Response } from "express";
import { Router } from "express";
import { commitFiles, getOctokitForRequest } from "../services/githubClient";

const router = Router();

function ensureAuthenticated(req: Request, res: Response, next: () => void) {
  if (!req.session.github?.accessToken) {
    res.status(401).json({ error: "GitHub authentication required" });
    return;
  }
  next();
}

router.use(ensureAuthenticated);

router.get("/user", async (req: Request, res: Response) => {
  try {
    const octokit = await getOctokitForRequest(req);
    const { data } = await octokit.users.getAuthenticated();
    res.json({
      login: data.login,
      avatarUrl: data.avatar_url,
      name: data.name,
      htmlUrl: data.html_url,
    });
  } catch (error) {
    console.error("Failed to fetch GitHub user", error);
    res.status(500).json({ error: "Failed to fetch GitHub user" });
  }
});

router.get("/repos", async (req: Request, res: Response) => {
  try {
    const octokit = await getOctokitForRequest(req);
    const [user, repos, orgMemberships] = await Promise.all([
      octokit.users.getAuthenticated(),
      octokit.paginate(octokit.repos.listForAuthenticatedUser, {
        affiliation: "owner",
        per_page: 100,
      }),
      octokit.paginate(octokit.orgs.listForAuthenticatedUser, { per_page: 100 }).catch(() => []),
    ]);

    res.json({
      owner: {
        login: user.data.login,
        avatarUrl: user.data.avatar_url,
        htmlUrl: user.data.html_url,
      },
      orgs: orgMemberships.map((org) => ({
        login: org.login,
        avatarUrl: org.avatar_url,
        htmlUrl: org.url,
      })),
      repos: repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        private: repo.private,
        htmlUrl: repo.html_url,
        permissions: repo.permissions,
        defaultBranch: repo.default_branch,
      })),
    });
  } catch (error) {
    console.error("Failed to list GitHub repos", error);
    res.status(500).json({ error: "Failed to list GitHub repos" });
  }
});

router.post("/orgs/:org/repos", async (req: Request, res: Response) => {
  try {
    const octokit = await getOctokitForRequest(req);
    const { org } = req.params;
    const { name, description, private: isPrivate } = req.body ?? {};

    if (!name) {
      res.status(400).json({ error: "Repository name is required" });
      return;
    }

    const payload = {
      name,
      description,
      private: Boolean(isPrivate),
      auto_init: true,
    };

    const { data } =
      org === "self"
        ? await octokit.repos.createForAuthenticatedUser(payload)
        : await octokit.repos.createInOrg({
            org,
            ...payload,
          });

    res.status(201).json({
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      htmlUrl: data.html_url,
      defaultBranch: data.default_branch,
    });
  } catch (error) {
    console.error("Failed to create GitHub repo", error);
    res.status(500).json({ error: "Failed to create GitHub repo" });
  }
});

router.post("/repos/:owner/:repo/commit", async (req: Request, res: Response) => {
  try {
    const octokit = await getOctokitForRequest(req);
    const { owner, repo } = req.params;
    const { message, files, branch } = req.body ?? {};

    if (!message || !files || typeof files !== "object") {
      res.status(400).json({ error: "Commit message and files are required" });
      return;
    }

    const { commitSha } = await commitFiles(octokit, {
      owner,
      repo,
      branch: typeof branch === "string" && branch.length > 0 ? branch : undefined,
      message,
      files: files as Record<string, string>,
    });

    res.status(201).json({ commit: commitSha });
  } catch (error) {
    console.error("Failed to push commit", error);
    res.status(500).json({ error: "Failed to push commit" });
  }
});

export default router;

