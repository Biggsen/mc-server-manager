import type { Request, Response } from "express";
import { Router } from "express";
import { randomBytes } from "crypto";
import jwt from "jsonwebtoken";
import {
  appBaseUrl,
  authCallbackUrl,
  githubClientId,
  githubClientSecret,
  githubScope,
  requireAuthConfig,
} from "../config";
import { createLogger } from "../utils/logger";
import type { AuthTokenPayload } from "../middleware/auth";

const router = Router();
const logger = createLogger("backend-auth");
import { jwtSecret, jwtExpiry } from "../config";

const JWT_SECRET = jwtSecret;
const JWT_EXPIRY = jwtExpiry;

// Stateless in-memory OAuth state store
// Replaces session-based storage to avoid cookie issues in Electron OAuth flows
interface OAuthStateEntry {
  state: string;
  returnTo?: string;
  createdAt: number;
}

const oauthStateStore = new Map<string, OAuthStateEntry>();

// Clean up expired states (older than 10 minutes)
const STATE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [state, entry] of oauthStateStore.entries()) {
    if (now - entry.createdAt > STATE_EXPIRY_MS) {
      oauthStateStore.delete(state);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug("oauth-state-cleanup", {
      cleaned,
      remaining: oauthStateStore.size,
    });
  }
}, 5 * 60 * 1000); // Run cleanup every 5 minutes

router.get("/status", (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  
  const configured = Boolean(githubClientId && githubClientSecret);
  let authenticated = false;
  let login: string | null = null;
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
      authenticated = true;
      login = decoded.login;
    } catch (error) {
      // Token invalid or expired
      logger.debug("auth-status-token-invalid", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  logger.info("auth-status-checked", {
    configured,
    authenticated,
    login,
  });
  
  res.json({
    provider: "github",
    configured,
    authenticated,
    login,
    authorizeUrl: configured ? "/auth/github" : null,
  });
});

router.get("/github", (req: Request, res: Response) => {
  logger.info("oauth-started", {
    returnTo: typeof req.query.returnTo === "string" ? req.query.returnTo : undefined,
  });
  
  requireAuthConfig();

  if (!githubClientId || !githubClientSecret) {
    logger.error("oauth-failed", {
      reason: "GitHub OAuth environment variables are missing",
    }, "GitHub OAuth environment variables are missing");
    res.status(500).json({ error: "GitHub OAuth environment variables are missing" });
    return;
  }

  const state = randomBytes(24).toString("hex");
  const returnToParam = typeof req.query.returnTo === "string" ? req.query.returnTo : undefined;
  
  // Store state in in-memory store (stateless, no session dependency)
  oauthStateStore.set(state, {
    state,
    returnTo: returnToParam,
    createdAt: Date.now(),
  });

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", githubClientId);
  authorizeUrl.searchParams.set("redirect_uri", authCallbackUrl);
  authorizeUrl.searchParams.set("scope", githubScope);
  authorizeUrl.searchParams.set("state", state);

    logger.debug("oauth-state-created", {
      state: state.slice(0, 4) + "..." + state.slice(-4),
      returnTo: returnToParam,
      storeSize: oauthStateStore.size,
      authorizeUrl: authorizeUrl.toString(),
    });

  res.redirect(authorizeUrl.toString());
});

router.get("/github/callback", async (req: Request, res: Response) => {
  logger.info("oauth-callback-detected", {
    hasCode: typeof req.query.code === "string",
    hasState: typeof req.query.state === "string",
    storeSize: oauthStateStore.size,
  });
  
  try {
    const { code, state } = req.query;

    if (typeof code !== "string" || typeof state !== "string") {
      logger.error("oauth-failed", {
        reason: "Missing OAuth code or state",
        hasCode: typeof code === "string",
        hasState: typeof state === "string",
      }, "Missing OAuth code or state");
      res.status(400).json({ error: "Missing OAuth code or state" });
      return;
    }

    // Validate state from in-memory store (stateless, no session dependency)
    const stateEntry = oauthStateStore.get(state);
    if (!stateEntry) {
      logger.error("oauth-failed", {
        reason: "Invalid OAuth state - not found in store",
        receivedState: state.slice(0, 4) + "..." + state.slice(-4),
        storeSize: oauthStateStore.size,
      }, "Invalid OAuth state");
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    // Check if state has expired
    const now = Date.now();
    if (now - stateEntry.createdAt > STATE_EXPIRY_MS) {
      oauthStateStore.delete(state);
      logger.error("oauth-failed", {
        reason: "Invalid OAuth state - expired",
        receivedState: state.slice(0, 4) + "..." + state.slice(-4),
        age: now - stateEntry.createdAt,
      }, "Invalid OAuth state - expired");
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    logger.debug("oauth-state-validated", {
      state: state.slice(0, 4) + "..." + state.slice(-4),
      returnTo: stateEntry.returnTo,
    });

    if (!githubClientId || !githubClientSecret) {
      logger.error("oauth-failed", {
        reason: "GitHub OAuth environment variables are missing",
      }, "GitHub OAuth environment variables are missing");
      res.status(500).json({ error: "GitHub OAuth environment variables are missing" });
      return;
    }

    logger.debug("oauth-token-exchange-start", {
      codeLength: code.length,
    });

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
      }, errorMsg);
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
      }, errorMsg);
      throw new Error(errorMsg);
    }

    logger.debug("oauth-token-received", {
      hasToken: Boolean(tokenJson.access_token),
      scope: tokenJson.scope,
    });

    logger.debug("oauth-user-fetch-start", {});

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
      }, errorMsg);
      throw new Error(errorMsg);
    }

    const userJson = (await userResponse.json()) as {
      login: string;
      avatar_url?: string;
    };

    logger.debug("oauth-user-received", {
      login: userJson.login,
      hasAvatar: Boolean(userJson.avatar_url),
    });

    // Create JWT token instead of session
    const tokenPayload = {
      login: userJson.login,
      accessToken: tokenJson.access_token,
      scopes: tokenJson.scope ? tokenJson.scope.split(",") : undefined,
    };

    const jwtToken = jwt.sign(
      tokenPayload as object,
      JWT_SECRET,
      {
        expiresIn: JWT_EXPIRY,
      } as jwt.SignOptions
    );

    logger.info("oauth-token-issued", {
      login: userJson.login,
      scopes: tokenJson.scope ? tokenJson.scope.split(",") : undefined,
    });

    // Clean up used state from store
    oauthStateStore.delete(state);

    logger.info("oauth-completed", {
      login: userJson.login,
      storeSize: oauthStateStore.size,
    });

    // In development, use localhost callback (Electron can access this)
    // In production, use custom protocol
    const isDev = process.env.NODE_ENV === 'development' || (process.env.ELECTRON_MODE !== 'true');
    
    if (isDev) {
      // Development: Redirect to localhost callback with token in query params
      // Electron will open this URL in a hidden window to extract the token
      const callbackUrl = new URL("http://localhost:4000/api/auth/callback");
      callbackUrl.searchParams.set("token", jwtToken);
      callbackUrl.searchParams.set("login", userJson.login);
      
      res.redirect(callbackUrl.toString());
    } else {
      // Production: Use custom protocol
      const redirectUrl = new URL("mc-server-manager://auth");
      redirectUrl.searchParams.set("token", jwtToken);
      redirectUrl.searchParams.set("login", userJson.login);

      // Send HTML page that tries to open the protocol, with fallback message
      res.send(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Authentication Complete</title>
            <meta http-equiv="refresh" content="0;url=${redirectUrl.toString()}">
            <script>
              // Try to open the custom protocol
              window.location.href = "${redirectUrl.toString()}";
              
              // If still here after 2 seconds, show message
              setTimeout(function() {
                document.body.innerHTML = '<h1>Authentication Complete</h1><p>If the application did not open automatically, please return to the MC Server Manager application.</p><p>You can close this window.</p>';
              }, 2000);
            </script>
          </head>
          <body>
            <p>Redirecting to application...</p>
          </body>
        </html>
      `);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error("oauth-failed", {
      reason: "OAuth callback processing failed",
    }, errorMsg);
    res.status(500).json({ error: "GitHub OAuth callback failed" });
  }
});

// Temporary token store for development mode (stores most recent token)
let devTokenStore: { token: string; login: string; expires: number } | null = null;

// Development callback endpoint - shows success page and stores token for Electron to poll
router.get("/callback", (req: Request, res: Response) => {
  const token = req.query.token as string | undefined;
  const login = req.query.login as string | undefined;
  
  if (token && login) {
    logger.info("dev-callback-token-received", {
      login,
    });
    
    // Store token temporarily (expires in 2 minutes)
    devTokenStore = {
      token,
      login,
      expires: Date.now() + 2 * 60 * 1000,
    };
    
    // Return success page
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Authentication Complete</title>
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 50px; }
            .success { color: green; }
          </style>
        </head>
        <body>
          <h1 class="success">✓ Authentication Complete</h1>
          <p>You can close this window and return to the application.</p>
        </body>
      </html>
    `);
  } else {
    res.status(400).json({ error: "Missing token or login" });
  }
});

// Endpoint for Electron to poll and get the token (development only)
router.get("/callback/poll", (req: Request, res: Response) => {
  if (devTokenStore && Date.now() < devTokenStore.expires) {
    const { token, login } = devTokenStore;
    // Clear token after returning it (one-time use)
    devTokenStore = null;
    logger.info("dev-token-polled", {
      login,
    });
    res.json({ token, login });
  } else {
    res.json({ token: null, login: null });
  }
});

router.post("/logout", (req: Request, res: Response) => {
  // Token-based auth doesn't need server-side logout
  // Client just discards the token
  logger.info("logout-requested", {});
  res.json({ success: true });
});

export default router;

