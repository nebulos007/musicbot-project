import { Hono } from "hono";
import { type SessionVariables, requireSession } from "../lib/session";
import { type AppToken, clientCredentialsToken } from "../lib/tidal";

export const playbackRouter = new Hono<{
	Bindings: Env;
	Variables: SessionVariables;
}>();

const LISTEN_KINDS = new Set(["play_complete", "skip", "repeat"]);

playbackRouter.use("*", requireSession());

// Hands the browser Player SDK an app-level (client-credentials) TIDAL token.
// Playback on the web SDK only yields 30s previews from a third-party app token
// (full-track streaming needs r_usr+playback scopes TIDAL doesn't grant web
// apps), and previews are app-authenticated so they don't need the user's
// token/subscription. The token is minted server-side; the secret never leaves
// the Worker. clientId is public (already in the authorize redirect). Gated by
// requireSession so only signed-in users mint tokens. userId is null — the app
// token isn't tied to a user.
playbackRouter.get("/token", async (c) => {
	let token: AppToken;
	try {
		token = await clientCredentialsToken(c.env);
	} catch {
		return c.json({ error: "tidal_unavailable" }, 502);
	}
	return c.json({
		accessToken: token.accessToken,
		expiresAt: token.expiresAt,
		clientId: c.env.TIDAL_CLIENT_ID,
		userId: null,
	});
});

// Append-only capture of in-app listen signal (full plays, early skips,
// repeats) for the taste profile. Mirrors the feedback route's validate-then-
// insert shape; title/artist let the signal name the track (recs aren't in
// library_songs to join against).
playbackRouter.post("/listen", async (c) => {
	const userId = c.get("userId");

	const body = await c.req
		.json<{
			songId?: string;
			kind?: string;
			title?: string;
			artist?: string;
			msPlayed?: number;
		}>()
		.catch(() => ({}) as Record<string, never>);

	const songId = typeof body.songId === "string" ? body.songId.trim() : "";
	const kind = typeof body.kind === "string" ? body.kind : "";
	if (!songId || !LISTEN_KINDS.has(kind)) {
		return c.json({ error: "invalid_listen" }, 400);
	}
	const title = typeof body.title === "string" ? body.title : null;
	const artist = typeof body.artist === "string" ? body.artist : null;
	const msPlayed =
		typeof body.msPlayed === "number" && Number.isFinite(body.msPlayed)
			? Math.round(body.msPlayed)
			: null;

	await c.env.DB.prepare(
		"INSERT INTO listen_events (user_id, song_id, kind, title, artist, ms_played, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
	)
		.bind(userId, songId, kind, title, artist, msPlayed, Math.floor(Date.now() / 1000))
		.run();

	return c.json({ ok: true });
});
