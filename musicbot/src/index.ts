import { Hono } from "hono";
import { authRouter } from "./routes/auth";
import { libraryRouter } from "./routes/library";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.route("/api/auth", authRouter);
app.route("/api/library", libraryRouter);

// Anything that isn't /api/* is the SPA. Forward to Workers Assets so the
// single-page-application fallback (wrangler.jsonc) serves /index.html for
// deep-links like /login and /settings.
app.notFound((c) => {
	if (new URL(c.req.url).pathname.startsWith("/api/")) {
		return c.json({ error: "not_found" }, 404);
	}
	return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
