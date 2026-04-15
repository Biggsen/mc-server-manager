import type { Request, Response } from "express";
import { Router } from "express";
import {
  TELEDOSI_NOT_CONFIGURED_MESSAGE,
  isTeledosiConfigured,
} from "../config";
import {
  connectTeledosiClient,
  getTeledosiRecentLogs,
  getTeledosiStatus,
  streamTeledosiJournalFollow,
  teledosiSystemctl,
} from "../services/teledosiRemote";

const router = Router();

function notConfigured(res: Response): boolean {
  if (isTeledosiConfigured()) {
    return false;
  }
  res.status(503).json({ error: TELEDOSI_NOT_CONFIGURED_MESSAGE });
  return true;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

router.get("/status", async (_req: Request, res: Response) => {
  if (notConfigured(res)) return;
  try {
    const { state, raw } = await getTeledosiStatus();
    res.json({ state, raw });
  } catch (error) {
    console.error("Teledosi status error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.post("/start", async (_req: Request, res: Response) => {
  if (notConfigured(res)) return;
  try {
    const r = await teledosiSystemctl("start");
    const out = (r.stdout + r.stderr).trim();
    if (r.code !== 0) {
      res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
      return;
    }
    res.json({ ok: true, output: out || undefined });
  } catch (error) {
    console.error("Teledosi start error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.post("/stop", async (_req: Request, res: Response) => {
  if (notConfigured(res)) return;
  try {
    const r = await teledosiSystemctl("stop");
    const out = (r.stdout + r.stderr).trim();
    if (r.code !== 0) {
      res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
      return;
    }
    res.json({ ok: true, output: out || undefined });
  } catch (error) {
    console.error("Teledosi stop error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.post("/restart", async (_req: Request, res: Response) => {
  if (notConfigured(res)) return;
  try {
    const r = await teledosiSystemctl("restart");
    const out = (r.stdout + r.stderr).trim();
    if (r.code !== 0) {
      res.status(502).json({ error: out || `systemctl exited with code ${r.code}` });
      return;
    }
    res.json({ ok: true, output: out || undefined });
  } catch (error) {
    console.error("Teledosi restart error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.get("/logs", async (req: Request, res: Response) => {
  if (notConfigured(res)) return;
  const linesParam = typeof req.query.lines === "string" ? Number(req.query.lines) : undefined;
  try {
    const text = await getTeledosiRecentLogs(linesParam);
    res.json({ text });
  } catch (error) {
    console.error("Teledosi logs error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.get("/logs/stream", async (req: Request, res: Response) => {
  if (notConfigured(res)) return;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const sendEvent = (event: string, payload: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  let conn: Awaited<ReturnType<typeof connectTeledosiClient>>;
  try {
    conn = await connectTeledosiClient();
  } catch (error) {
    sendEvent("streamerror", { message: formatError(error) });
    res.end();
    return;
  }

  sendEvent("init", { ok: true });

  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 25000);

  const cleanup = () => {
    clearInterval(keepAlive);
    try {
      conn.end();
    } catch {
      /* ignore */
    }
  };

  req.on("close", () => {
    cleanup();
    res.end();
  });

  streamTeledosiJournalFollow(
    conn,
    (line) => sendEvent("log", { line }),
    (err) => {
      sendEvent("streamerror", { message: err.message });
      cleanup();
      res.end();
    },
  );
});

export default router;
