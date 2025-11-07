import type { Express } from "express";
import projectsRouter from "./projects";

export function registerRoutes(app: Express): void {
  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/projects", projectsRouter);
}

