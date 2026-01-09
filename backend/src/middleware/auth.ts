import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { createLogger } from "../utils/logger";

const logger = createLogger("backend-auth-middleware");
import { jwtSecret } from "../config";

const JWT_SECRET = jwtSecret;

export interface AuthTokenPayload {
  login: string;
  accessToken: string; // GitHub access token
  scopes?: string[];
  iat: number;
  exp: number;
}

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: AuthTokenPayload;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  
  if (!token) {
    logger.debug("auth-token-missing", {
      path: req.path,
    });
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
    req.user = decoded;
    logger.debug("auth-token-valid", {
      login: decoded.login,
      path: req.path,
    });
    next();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn("auth-token-invalid", {
      path: req.path,
      error: errorMsg,
    });
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function optionalAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthTokenPayload;
      req.user = decoded;
    } catch {
      // Invalid token, but continue without auth
    }
  }
  next();
}
