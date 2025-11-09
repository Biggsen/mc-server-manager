import type { Express } from "express";
import authRouter from "./auth";
import projectsRouter from "./projects";
import buildsRouter from "./builds";
import githubRouter from "./github";
import deploymentsRouter from "./deployments";
import pluginsRouter from "./plugins";
import runsRouter from "./runs";

export function registerRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/projects", projectsRouter);
  app.use("/api/builds", buildsRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/github", githubRouter);
  app.use("/api/deployments", deploymentsRouter);
  app.use("/api/plugins", pluginsRouter);
  app.use("/api/runs", runsRouter);
}

