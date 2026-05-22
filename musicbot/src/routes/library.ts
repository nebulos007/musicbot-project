import { Hono } from "hono";
import {
	type SessionVariables,
	requireSession,
} from "../lib/session";
import { fetchAllLibrary, refreshIfNeeded } from "../lib/tidal";

export const libraryRouter = new Hono<{
	Bindings: Env;
	Variables: SessionVariables;
}>();

libraryRouter.use("*", requireSession());

libraryRouter.post("/sync", async (c) => {
	const userId = c.get("userId");
	const accessToken = await refreshIfNeeded(c.env, userId);
	const songs = await fetchAllLibrary({ accessToken });

	const now = Math.floor(Date.now() / 1000);
	if (songs.length > 0) {
		const stmt = c.env.DB.prepare(
			`INSERT INTO library_songs (user_id, song_id, title, artist, album, album_art_url, added_at, synced_at)
			 VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)
			 ON CONFLICT(user_id, song_id) DO UPDATE SET
			   title = excluded.title,
			   artist = excluded.artist,
			   added_at = excluded.added_at,
			   synced_at = excluded.synced_at`,
		);
		await c.env.DB.batch(
			songs.map((s) =>
				stmt.bind(userId, s.songId, s.title, s.artist, s.addedAt, now),
			),
		);
	}

	return c.json({ synced: songs.length, syncedAt: now });
});

libraryRouter.get("/count", async (c) => {
	const userId = c.get("userId");
	const row = await c.env.DB.prepare(
		"SELECT COUNT(*) AS n FROM library_songs WHERE user_id = ?",
	)
		.bind(userId)
		.first<{ n: number }>();
	return c.json({ count: row?.n ?? 0 });
});
