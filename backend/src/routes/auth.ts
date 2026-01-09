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
import { createLogger } from "../utils/logger";

const router = Router();
const logger = createLogger("backend-auth");

router.get("/status", (req: Request, res: Response) => {
  const sessionId = req.sessionID;
  const configured = Boolean(githubClientId && githubClientSecret);
  const authenticated = Boolean(req.session.github);
  
  logger.info("session-validated", {
    configured,
    authenticated,
    login: req.session.github?.login ?? null,
  }, sessionId);
  
  res.json({
    provider: "github",
    configured,
    authenticated,
    login: req.session.github?.login ?? null,
    authorizeUrl: configured ? "/auth/github" : null,
  });
});

router.get("/github", (req: Request, res: Response) => {
  const sessionId = req.sessionID;
  
  logger.info("oauth-started", {
    returnTo: typeof req.query.returnTo === "string" ? req.query.returnTo : undefined,
  }, sessionId);
  
  requireAuthConfig();

  if (!githubClientId || !githubClientSecret) {
    logger.error("oauth-failed", {
      reason: "GitHub OAuth environment variables are missing",
    }, sessionId, "GitHub OAuth environment variables are missing");
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

  logger.debug("oauth-state-created", {
    state: state.slice(0, 4) + "..." + state.slice(-4),
    authorizeUrl: authorizeUrl.toString(),
  }, sessionId);

  res.redirect(authorizeUrl.toString());
});

router.get("/github/callback", async (req: Request, res: Response) => {
  const sessionId = req.sessionID;
  
  logger.info("oauth-callback-detected", {
    hasCode: typeof req.query.code === "string",
    hasState: typeof req.query.state === "string",
    hasSessionState: Boolean(req.session.oauthState),
  }, sessionId);
  
  try {
    const { code, state } = req.query;

    if (typeof code !== "string" || typeof state !== "string") {
      logger.error("oauth-failed", {
        reason: "Missing OAuth code or state",
        hasCode: typeof code === "string",
        hasState: typeof state === "string",
      }, sessionId, "Missing OAuth code or state");
      res.status(400).json({ error: "Missing OAuth code or state" });
      return;
    }

    if (!req.session.oauthState || state !== req.session.oauthState) {
      logger.error("oauth-failed", {
        reason: "Invalid OAuth state",
        expectedState: req.session.oauthState ? req.session.oauthState.slice(0, 4) + "..." + req.session.oauthState.slice(-4) : null,
        receivedState: state.slice(0, 4) + "..." + state.slice(-4),
      }, sessionId, "Invalid OAuth state");
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    if (!githubClientId || !githubClientSecret) {
      logger.error("oauth-failed", {
        reason: "GitHub OAuth environment variables are missing",
      }, sessionId, "GitHub OAuth environment variables are missing");
      res.status(500).json({ error: "GitHub OAuth environment variables are missing" });
      return;
    }

    logger.debug("oauth-token-exchange-start", {
      codeLength: code.length,
    }, sessionId);

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
      const errorMsg = `Failed to exchange OAuth code: ${text}`;
      logger.error("oauth-failed", {
        reason: "Token exchange failed",
        status: tokenResponse.status,
      }, sessionId, errorMsg);
      throw new Error(errorMsg);
    }

    const tokenJson = (await tokenResponse.json()) as {
      access_token?: string;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenJson.access_token) {
      const errorMsg = tokenJson.error_description ?? tokenJson.error ?? "No access token returned";
      logger.error("oauth-failed", {
        reason: "No access token in response",
        error: tokenJson.error,
      }, sessionId, errorMsg);
      throw new Error(errorMsg);
    }

    logger.debug("oauth-token-received", {
      hasToken: Boolean(tokenJson.access_token),
      scope: tokenJson.scope,
    }, sessionId);

    logger.debug("oauth-user-fetch-start", {}, sessionId);

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${tokenJson.access_token}`,
        "User-Agent": "mc-server-manager",
      },
    });

    if (!userResponse.ok) {
      const text = await userResponse.text();
      const errorMsg = `Failed to load GitHub user profile: ${text}`;
      logger.error("oauth-failed", {
        reason: "User profile fetch failed",
        status: userResponse.status,
      }, sessionId, errorMsg);
      throw new Error(errorMsg);
    }

    const userJson = (await userResponse.json()) as {
      login: string;
      avatar_url?: string;
    };

    logger.debug("oauth-user-received", {
      login: userJson.login,
      hasAvatar: Boolean(userJson.avatar_url),
    }, sessionId);

    req.session.github = {
      accessToken: tokenJson.access_token,
      login: userJson.login,
      avatarUrl: userJson.avatar_url,
      scopes: tokenJson.scope ? tokenJson.scope.split(",") : undefined,
    };

    logger.info("session-created", {
      login: userJson.login,
      scopes: tokenJson.scope ? tokenJson.scope.split(",") : undefined,
    }, sessionId);

    const redirectTarget = req.session.returnTo ?? appBaseUrl;
    delete req.session.oauthState;
    delete req.session.returnTo;

    logger.info("oauth-completed", {
      redirectTarget,
      login: userJson.login,
    }, sessionId);

    res.redirect(redirectTarget);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("oauth-failed", {
      reason: "OAuth callback processing failed",
    }, req.sessionID, errorMsg);
    res.status(500).json({ error: "GitHub OAuth callback failed" });
  }
});

router.post("/logout", (req: Request, res: Response) => {
  const sessionId = req.sessionID;
  const login = req.session.github?.login;
  
  logger.info("session-destroy-start", {
    login,
  }, sessionId);
  
  req.session.destroy((err) => {
    if (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error("session-destroy-failed", {
        login,
      }, sessionId, errorMsg);
      res.status(500).json({ error: "Failed to logout" });
      return;
    }
    
    logger.info("session-destroyed", {
      login,
    }, sessionId);
    res.json({ success: true });
  });
});

export default router;

