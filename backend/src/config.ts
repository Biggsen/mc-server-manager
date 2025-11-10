import { config as loadEnv } from "dotenv";

loadEnv({ path: process.env.ENV_FILE ?? "./.env" });

export const githubClientId = process.env.GITHUB_CLIENT_ID ?? "";
export const githubClientSecret = process.env.GITHUB_CLIENT_SECRET ?? "";
export const authCallbackUrl =
  process.env.AUTH_CALLBACK_URL ?? "http://localhost:4000/api/auth/github/callback";
export const sessionSecret = process.env.SESSION_SECRET ?? "development-secret";
export const githubScope = process.env.GITHUB_SCOPE ?? "repo delete_repo read:user";
export const appBaseUrl = process.env.APP_BASE_URL ?? "http://localhost:5173";

export function requireAuthConfig(): void {
  if (!githubClientId || !githubClientSecret) {
    console.warn("GitHub OAuth not configured. Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET in your .env file.");
  }
}

