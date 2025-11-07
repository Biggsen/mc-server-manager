import type { Express } from "express";
import authRouter from "./auth";
import projectsRouter from "./projects";

export function registerRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/projects", projectsRouter);
  app.use("/auth", authRouter);
}

