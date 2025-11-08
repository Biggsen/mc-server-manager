import type { Express } from "express";
import authRouter from "./auth";
import projectsRouter from "./projects";
import buildsRouter from "./builds";

export function registerRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/projects", projectsRouter);
  app.use("/api/builds", buildsRouter);
  app.use("/api/auth", authRouter);
}

