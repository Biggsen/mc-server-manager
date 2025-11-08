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

