import { config as loadEnv } from "dotenv";

loadEnv({ path: process.env.ENV_FILE ?? "./.env" });

export const githubClientId = process.env.GITHUB_CLIENT_ID ?? "";
export const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";
export const authCallbackUrl = process.env.AUTH_CALLBACK_URL ?? "http://localhost:4000/auth/github/callback";
export const sessionSecret = process.env.SESSION_SECRET ?? "development-secret";

export function requireAuthConfig(): void {
  if (!githubClientId || !githubClientSecret) {
    console.warn("GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env file.");
  }
}

