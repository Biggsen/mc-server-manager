import "express-session";

declare module "express-session" {
  interface SessionData {
    oauthState?: string;
    returnTo?: string;
    github?: {
      accessToken: string;
      login: string;
      avatarUrl?: string;
      scopes?: string[];
    };
  }
}

