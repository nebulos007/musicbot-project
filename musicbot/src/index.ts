import { Hono } from "hono";
import { authRouter } from "./routes/auth";
import { libraryRouter } from "./routes/library";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/health", (c) => c.json({ status: "ok" }));
app.route("/api/auth", authRouter);
app.route("/api/library", libraryRouter);

// SPA fallback. Anything not handled by the API routes above and not a real
// asset is the React app — serve /index.html so the client router can pick up
// /login, /settings, etc. on deep-link reloads. Explicitly fetching the index
// asset (rather than passing c.req.raw through) avoids relying on the
// `not_found_handling` flag, which would intercept navigations to /api/* and
// break OAuth redirects.
app.notFound((c) => {
	if (new URL(c.req.url).pathname.startsWith("/api/")) {
		return c.json({ error: "not_found" }, 404);
	}
	const indexUrl = new URL("/index.html", c.req.url);
	return c.env.ASSETS.fetch(new Request(indexUrl, { method: "GET" }));
});

export default app;
