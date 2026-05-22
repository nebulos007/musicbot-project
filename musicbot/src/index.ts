import { Hono } from "hono";
import { authRouter } from "./routes/auth";
import { libraryRouter } from "./routes/library";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.route("/api/auth", authRouter);
app.route("/api/library", libraryRouter);

export default app;
