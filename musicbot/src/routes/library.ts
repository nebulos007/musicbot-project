import { Hono } from "hono";
import {
	type SessionVariables,
	requireSession,
} from "../lib/session";
import {
	LIBRARY_SORTS,
	fetchCollectionSize,
	fetchLibrarySort,
	refreshIfNeeded,
} from "../lib/tidal";

export const libraryRouter = new Hono<{
	Bindings: Env;
	Variables: SessionVariables;
}>();

libraryRouter.use("*", requireSession());

// Resumable library sync. Two full pagination passes exceed the free Workers
// plan's 50-subrequest cap, so one /sync call fetches ONE sort order (~28
// subrequests) and the client loops over the passes. Every row a pass sees is
// stamped synced_at = syncId — a generation id shared across the loop's calls —
// so the union of all passes carries the same syncId. When that union reaches
// TIDAL's numberOfItems we know the fetch is complete and sweep any row with an
// older synced_at (a track removed in TIDAL). A partial union never sweeps.
libraryRouter.post("/sync", async (c) => {
	const userId = c.get("userId");
	const accessToken = await refreshIfNeeded(c.env, userId);

	const now = Math.floor(Date.now() / 1000);
	const pass = Math.max(0, Math.trunc(Number(c.req.query("pass")) || 0));
	const syncId = Math.trunc(Number(c.req.query("syncId"))) || now;

	const total = await fetchCollectionSize({ accessToken });

	const sort = LIBRARY_SORTS[pass];
	if (sort) {
		const songs = await fetchLibrarySort(sort, { accessToken });
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
					stmt.bind(userId, s.songId, s.title, s.artist, s.addedAt, syncId),
				),
			);
		}
	}

	// Union so far = rows stamped with this syncId across the loop's passes.
	const unionRow = await c.env.DB.prepare(
		"SELECT COUNT(*) AS n FROM library_songs WHERE user_id = ? AND synced_at = ?",
	)
		.bind(userId, syncId)
		.first<{ n: number }>();
	const unionCount = unionRow?.n ?? 0;
	const complete = total !== null && unionCount >= total;

	let removed = 0;
	if (complete) {
		const res = await c.env.DB.prepare(
			"DELETE FROM library_songs WHERE user_id = ? AND synced_at < ?",
		)
			.bind(userId, syncId)
			.run();
		removed = res.meta.changes ?? 0;
	}

	const nextPass = !complete && pass + 1 < LIBRARY_SORTS.length ? pass + 1 : null;
	return c.json({ synced: unionCount, total, complete, removed, syncId, nextPass });
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
