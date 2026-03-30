import { createWriteStream } from "fs";
import { join } from "path";
import type { Server } from "http";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import multer from "multer";
import "./config";
import { describeMaxConfigPayload, maxConfigPayloadBytes } from "./config";
import { registerRoutes } from "./routes";

// Set up file logging in Electron mode (after imports but before any console.log usage)
if (process.env.ELECTRON_MODE === "true" && process.env.USER_DATA_PATH) {
  const logPath = join(process.env.USER_DATA_PATH, "backend.log");
  const logStream = createWriteStream(logPath, { flags: "a" });
  
  // Override console methods to write to both console and file
  const originalLog = console.log;
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  
  const writeToFile = (level: string, ...args: unknown[]) => {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === "object" ? JSON.stringify(arg) : String(arg)
    ).join(" ");
    logStream.write(`[${timestamp}] [${level}] ${message}\n`);
  };
  
  console.log = (...args: unknown[]) => {
    originalLog(...args);
    writeToFile("LOG", ...args);
  };
  
  console.error = (...args: unknown[]) => {
    originalError(...args);
    writeToFile("ERROR", ...args);
  };
  
  console.warn = (...args: unknown[]) => {
    originalWarn(...args);
    writeToFile("WARN", ...args);
  };
  
  console.info = (...args: unknown[]) => {
    originalInfo(...args);
    writeToFile("INFO", ...args);
  };
  
  console.debug = (...args: unknown[]) => {
    originalDebug(...args);
    writeToFile("DEBUG", ...args);
  };
  
  console.log(`[Backend] File logging enabled: ${logPath}`);
}

export function createApp(): express.Application {
  const app = express();

  // CORS middleware for Electron and web clients
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    // Allow requests from Electron (localhost origins) and file:// protocol
    if (origin && (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:'))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    } else if (!origin || origin.startsWith('file://')) {
      // Allow requests without origin or from file:// (Electron in production)
      res.setHeader('Access-Control-Allow-Origin', '*');
      // Note: Cannot use credentials with wildcard origin
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: maxConfigPayloadBytes }));

  // Log all incoming requests
  app.use((req: Request, _res: Response, next: NextFunction) => {
    console.log(`[Backend] Incoming request: ${req.method} ${req.path}`);
    next();
  });

  registerRoutes(app);

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Route not found" });
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error", error);

    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      const max = describeMaxConfigPayload();
      res.status(413).json({
        error: `Config upload is too large (maximum ${max} per file). Use a smaller file or split the config.`,
      });
      return;
    }

    if (error && typeof error === "object") {
      const e = error as { type?: string; status?: number; message?: string };
      if (e.type === "entity.too.large") {
        const max = describeMaxConfigPayload();
        res.status(413).json({
          error: `Request body is too large (maximum ${max} for JSON). The config editor sends the whole file in one request, so very large configs cannot be saved this way. Use Replace to upload from disk, or edit the file outside the app. Set MCSM_MAX_CONFIG_PAYLOAD_MB in the backend environment to raise the limit (high values use a lot of memory).`,
        });
        return;
      }
      if (e.type === "entity.parse.failed") {
        res.status(400).json({ error: "Invalid JSON in the request body." });
        return;
      }
    }

    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export async function startServer(port: number = 4000): Promise<Server> {
  const app = createApp();
  return new Promise((resolve, reject) => {
    try {
      const server = app.listen(port, '127.0.0.1', () => {
        console.log(`MC Server Manager backend listening on http://127.0.0.1:${port}`);
        resolve(server);
      }).on('error', (err: Error) => {
        reject(err);
      });
    } catch (err) {
      reject(err);
    }
  });
}

// Only start if run directly (not imported)
if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  let server: Server | null = null;
  
  startServer(port)
    .then((s) => {
      server = s;
    })
    .catch((error) => {
      console.error("Failed to start server:", error);
      process.exit(1);
    });
  
  // Handle graceful shutdown
  const shutdown = () => {
    if (server) {
      console.log("Shutting down server...");
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };
  
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

