import type { Request, Response, NextFunction } from "express";
import express from "express";
import session from "express-session";
import { sessionSecret } from "./config";
import "./config";
import { registerRoutes } from "./routes";

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
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json());
  app.use(
    session({
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: false,
      },
    }),
  );

  registerRoutes(app);

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: "Route not found" });
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error", error);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

export async function startServer(port: number = 4000): Promise<void> {
  const app = createApp();
  return new Promise((resolve) => {
    app.listen(port, '127.0.0.1', () => {
      console.log(`MC Server Manager backend listening on http://127.0.0.1:${port}`);
      resolve();
    });
  });
}

// Only start if run directly (not imported)
if (require.main === module) {
  const port = Number(process.env.PORT ?? 4000);
  startServer(port).catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}

