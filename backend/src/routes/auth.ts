import type { Request, Response } from "express";
import { Router } from "express";
import { authCallbackUrl, githubClientId, requireAuthConfig } from "../config";

const router = Router();

router.get("/status", (_req: Request, res: Response) => {
  const configured = Boolean(githubClientId);
  res.json({
    provider: "github",
    configured,
    authorizeUrl: configured
      ? `/auth/github?redirect=${encodeURIComponent(authCallbackUrl)}`
      : null,
  });
});

router.get("/github", (_req: Request, res: Response) => {
  requireAuthConfig();
  res.status(501).json({
    error: "GitHub OAuth integration not yet implemented",
    hint: "Use the status endpoint to confirm env vars and configure GitHub before enabling auth.",
  });
});

router.get("/github/callback", (_req: Request, res: Response) => {
  res.status(501).json({
    error: "GitHub OAuth callback not implemented",
    next: "Exchange code for token, link user session, and redirect to frontend.",
  });
});

export default router;

