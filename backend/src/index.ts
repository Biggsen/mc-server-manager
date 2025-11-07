import express from "express";

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`MC Server Manager backend listening on port ${port}`);
});

