import { Hono } from "hono";
import { type SessionVariables, requireSession } from "../lib/session";
import { addToLibrary, refreshIfNeeded } from "../lib/tidal";

export const feedbackRouter = new Hono<{
	Bindings: Env;
	Variables: SessionVariables;
}>();

const KINDS = new Set(["like", "dislike", "add"]);

feedbackRouter.use("*", requireSession());

feedbackRouter.post("/", async (c) => {
	const userId = c.get("userId");

	const body = await c.req
		.json<{ songId?: string; kind?: string }>()
		.catch(() => ({}) as { songId?: string; kind?: string });
	const songId = typeof body.songId === "string" ? body.songId.trim() : "";
	const kind = typeof body.kind === "string" ? body.kind : "";
	if (!songId || !KINDS.has(kind)) {
		return c.json({ error: "invalid_feedback" }, 400);
	}

	// "add" must actually land in TIDAL before we record it, so a recorded
	// event always implies the add succeeded (the UI reverts on a non-2xx).
	if (kind === "add") {
		try {
			const accessToken = await refreshIfNeeded(c.env, userId);
			await addToLibrary(songId, { accessToken });
		} catch {
			return c.json({ error: "add_failed" }, 502);
		}
	}

	await c.env.DB.prepare(
		"INSERT INTO feedback_events (user_id, song_id, kind, created_at) VALUES (?, ?, ?, ?)",
	)
		.bind(userId, songId, kind, Math.floor(Date.now() / 1000))
		.run();

	return c.json({ ok: true });
});
