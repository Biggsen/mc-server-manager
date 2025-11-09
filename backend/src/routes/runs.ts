import { Router } from "express";
import { getRun, listRuns, stopRun } from "../services/runQueue";

const router = Router();

router.get("/", (req, res) => {
  const { status } = req.query;
  let runs = listRuns();
  if (typeof status === "string" && status.trim().length > 0) {
    runs = runs.filter((run) => run.status === status);
  }
  res.json({ runs });
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

export default router;


