import type { Request, Response } from "express";
import { Router } from "express";
import {
  TELEDOSI_FILES_NOT_CONFIGURED_MESSAGE,
  TELEDOSI_NOT_CONFIGURED_MESSAGE,
  isTeledosiConfigured,
  isTeledosiFilesConfigured,
  teledosiFilesMaxBytes,
  teledosiSftpRemoteRoot,
} from "../config";
import {
  connectTeledosiClient,
  getTeledosiRecentLogs,
  getTeledosiStatus,
  streamTeledosiJournalFollow,
  teledosiSystemctl,
} from "../services/teledosiRemote";
import {
  teledosiFilesList,
  TeledosiFileTooLargeError,
  teledosiFilesRead,
  teledosiFilesWrite,
} from "../services/teledosiFiles";

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

router.get("/files/config", (_req: Request, res: Response) => {
  if (notConfigured(res)) return;
  res.json({
    filesConfigured: isTeledosiFilesConfigured(),
    remoteRoot: isTeledosiFilesConfigured() ? teledosiSftpRemoteRoot : undefined,
    maxBytes: teledosiFilesMaxBytes,
    hint: isTeledosiFilesConfigured()
      ? undefined
      : TELEDOSI_FILES_NOT_CONFIGURED_MESSAGE,
  });
});

function filesNotReady(res: Response): boolean {
  if (isTeledosiFilesConfigured()) {
    return false;
  }
  res.status(503).json({ error: TELEDOSI_FILES_NOT_CONFIGURED_MESSAGE });
  return true;
}

router.get("/files/list", async (req: Request, res: Response) => {
  if (notConfigured(res)) return;
  if (filesNotReady(res)) return;
  const pathParam = typeof req.query.path === "string" ? req.query.path : "";
  try {
    const entries = await teledosiFilesList(pathParam);
    res.json({ entries });
  } catch (error) {
    console.error("Teledosi files list error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

router.get("/files/read", async (req: Request, res: Response) => {
  if (notConfigured(res)) return;
  if (filesNotReady(res)) return;
  const pathParam = typeof req.query.path === "string" ? req.query.path : "";
  if (!pathParam.trim()) {
    res.status(400).json({ error: "path query parameter is required" });
    return;
  }
  try {
    const { content, isBinary } = await teledosiFilesRead(pathParam);
    res.json({ path: pathParam, content, isBinary });
  } catch (error) {
    console.error("Teledosi files read error", error);
    if (error instanceof TeledosiFileTooLargeError) {
      res.status(413).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: formatError(error) });
  }
});

router.put("/files/write", async (req: Request, res: Response) => {
  if (notConfigured(res)) return;
  if (filesNotReady(res)) return;
  const body = req.body ?? {};
  const pathParam = typeof body.path === "string" ? body.path : "";
  const content = typeof body.content === "string" ? body.content : undefined;
  if (!pathParam.trim() || content === undefined) {
    res.status(400).json({ error: "path and content are required" });
    return;
  }
  try {
    await teledosiFilesWrite(pathParam, content);
    res.json({ ok: true });
  } catch (error) {
    console.error("Teledosi files write error", error);
    res.status(502).json({ error: formatError(error) });
  }
});

export default router;
