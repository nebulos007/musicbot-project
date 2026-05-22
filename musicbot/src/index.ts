import { Hono } from "hono";
import { authRouter } from "./routes/auth";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.route("/api/auth", authRouter);

export default app;
