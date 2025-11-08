import type { Request, Response, NextFunction } from "express";
import express from "express";
import session from "express-session";
import { sessionSecret } from "./config";
import "./config";
import { registerRoutes } from "./routes";

const app = express();
const port = Number(process.env.PORT ?? 4000);

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

app.listen(port, () => {
  console.log(`MC Server Manager backend listening on port ${port}`);
});

