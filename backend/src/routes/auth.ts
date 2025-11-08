import type { Request, Response } from "express";
import { Router } from "express";
import { randomBytes } from "crypto";
import {
  appBaseUrl,
  authCallbackUrl,
  githubClientId,
  githubClientSecret,
  githubScope,
  requireAuthConfig,
} from "../config";

const router = Router();

router.get("/status", (req: Request, res: Response) => {
  const configured = Boolean(githubClientId && githubClientSecret);
  res.json({
    provider: "github",
    configured,
    authenticated: Boolean(req.session.github),
    login: req.session.github?.login ?? null,
    authorizeUrl: configured ? "/auth/github" : null,
  });
});

router.get("/github", (req: Request, res: Response) => {
  requireAuthConfig();

  if (!githubClientId || !githubClientSecret) {
    res.status(500).json({ error: "GitHub OAuth environment variables are missing" });
    return;
  }

  const state = randomBytes(24).toString("hex");
  req.session.oauthState = state;

  const returnToParam = typeof req.query.returnTo === "string" ? req.query.returnTo : undefined;
  if (returnToParam) {
    req.session.returnTo = returnToParam;
  }

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", githubClientId);
  authorizeUrl.searchParams.set("redirect_uri", authCallbackUrl);
  authorizeUrl.searchParams.set("scope", githubScope);
  authorizeUrl.searchParams.set("state", state);

  res.redirect(authorizeUrl.toString());
});

router.get("/github/callback", async (req: Request, res: Response) => {
  try {
    const { code, state } = req.query;

    if (typeof code !== "string" || typeof state !== "string") {
      res.status(400).json({ error: "Missing OAuth code or state" });
      return;
    }

    if (!req.session.oauthState || state !== req.session.oauthState) {
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    if (!githubClientId || !githubClientSecret) {
      res.status(500).json({ error: "GitHub OAuth environment variables are missing" });
      return;
    }

    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: githubClientId,
        client_secret: githubClientSecret,
        code,
        redirect_uri: authCallbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const text = await tokenResponse.text();
      throw new Error(`Failed to exchange OAuth code: ${text}`);
    }

    const tokenJson = (await tokenResponse.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenJson.access_token) {
      throw new Error(tokenJson.error_description ?? tokenJson.error ?? "No access token returned");
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenJson.access_token}`,
        "User-Agent": "mc-server-manager",
      },
    });

    if (!userResponse.ok) {
      const text = await userResponse.text();
      throw new Error(`Failed to load GitHub user profile: ${text}`);
    }

    const userJson = (await userResponse.json()) as {
      login: string;
      avatar_url?: string;
    };

    req.session.github = {
      accessToken: tokenJson.access_token,
      login: userJson.login,
      avatarUrl: userJson.avatar_url,
      scopes: tokenJson.scope ? tokenJson.scope.split(",") : undefined,
    };

    const redirectTarget = req.session.returnTo ?? appBaseUrl;
    delete req.session.oauthState;
    delete req.session.returnTo;

    res.redirect(redirectTarget);
  } catch (error) {
    console.error("GitHub OAuth callback failed", error);
    res.status(500).json({ error: "GitHub OAuth callback failed" });
  }
});

router.post("/logout", (req: Request, res: Response) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Failed to destroy session", err);
      res.status(500).json({ error: "Failed to logout" });
      return;
    }
    res.json({ success: true });
  });
});

export default router;

