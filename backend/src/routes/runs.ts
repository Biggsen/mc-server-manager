import type { Request, Response } from "express";
import { Router } from "express";
import { getRun, listRuns, stopRun, subscribeRunEvents, sendRunCommand } from "../services/runQueue";

const router = Router();

router.get("/", (req, res) => {
  const { status } = req.query;
  let runs = listRuns();
  if (typeof status === "string" && status.trim().length > 0) {
    runs = runs.filter((run) => run.status === status);
  }
  res.json({ runs });
});

router.get("/stream", (req: Request, res: Response) => {
  const projectId =
    typeof req.query.projectId === "string" && req.query.projectId.trim().length > 0
      ? req.query.projectId.trim()
      : undefined;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent("init", { runs: projectId ? listRuns(projectId) : listRuns() });

  const unsubscribe = subscribeRunEvents((event) => {
    if (event.type === "run-update") {
      if (projectId && event.run.projectId !== projectId) {
        return;
      }
      sendEvent("run-update", { run: event.run });
    } else if (event.type === "run-log") {
      if (projectId && event.projectId !== projectId) {
        return;
      }
      sendEvent("run-log", {
        runId: event.runId,
        projectId: event.projectId,
        entry: event.entry,
      });
    }
  });

  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
});

router.post("/:id/stop", async (req, res) => {
  try {
    const { id } = req.params;
    const run = getRun(id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    const updated = await stopRun(id);
    res.json({ run: updated });
  } catch (error) {
    console.error("Failed to stop run", error);
    res.status(500).json({ error: "Failed to stop run" });
  }
});

router.post("/:id/command", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { command } = req.body ?? {};
    if (typeof command !== "string" || command.trim().length === 0) {
      res.status(400).json({ error: "Command is required" });
      return;
    }

    const run = getRun(id);
    if (!run) {
      res.status(404).json({ error: "Run not found" });
      return;
    }

    await sendRunCommand(id, command);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error("Failed to send run command", error);
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not found")) {
      res.status(404).json({ error: message });
      return;
    }
    if (message.includes("empty") || message.includes("Command cannot")) {
      res.status(400).json({ error: message });
      return;
    }
    if (message.includes("not accepting") || message.includes("Command channel")) {
      res.status(409).json({ error: message });
      return;
    }
    res.status(500).json({ error: "Failed to send command" });
  }
});

export default router;


