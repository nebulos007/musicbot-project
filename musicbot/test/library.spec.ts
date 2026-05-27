import { SELF, env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, createSession } from "../src/lib/session";
import { tokensKvKey } from "../src/lib/tidal";

async function resetDb() {
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tidal_user_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS library_songs (user_id TEXT NOT NULL, song_id TEXT NOT NULL, title TEXT NOT NULL, artist TEXT NOT NULL, album TEXT, album_art_url TEXT, added_at INTEGER NOT NULL, synced_at INTEGER NOT NULL, PRIMARY KEY (user_id, song_id), FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
	);
	await env.DB.exec("DELETE FROM library_songs");
	await env.DB.exec("DELETE FROM sessions");
	await env.DB.exec("DELETE FROM users");
}

async function clearKv() {
	const list = await env.SESSIONS.list();
	for (const k of list.keys) await env.SESSIONS.delete(k.name);
}

async function seedAuthedUser(): Promise<{ userId: string; cookie: string }> {
	const userId = crypto.randomUUID();
	await env.DB.prepare(
		"INSERT INTO users (id, tidal_user_id, created_at) VALUES (?, ?, ?)",
	)
		.bind(userId, `tidal_${userId}`, Math.floor(Date.now() / 1000))
		.run();

	// Fresh access token, expires far in the future so refreshIfNeeded skips refresh.
	await env.SESSIONS.put(
		tokensKvKey(userId),
		JSON.stringify({
			accessToken: "test-access-token",
			refreshToken: "test-refresh-token",
			expiresAt: Math.floor(Date.now() / 1000) + 3600,
			scope: "user.read collection.read collection.write",
			tokenType: "Bearer",
		}),
	);

	const { id: sessionId } = await createSession(env.DB, userId);
	return { userId, cookie: `${SESSION_COOKIE_NAME}=${sessionId}` };
}

function libraryPage(opts: {
	items: Array<{ id: string; addedAt?: string }>;
	tracks: Array<{ id: string; title: string; artistIds: string[] }>;
	artists: Array<{ id: string; name: string }>;
	next?: string;
}) {
	return {
		data: opts.items.map((i) => ({
			id: i.id,
			type: "tracks",
			meta: { addedAt: i.addedAt ?? "2026-01-01T00:00:00Z" },
		})),
		included: [
			...opts.tracks.map((t) => ({
				id: t.id,
				type: "tracks",
				attributes: { title: t.title },
				relationships: {
					artists: { data: t.artistIds.map((id) => ({ type: "artists", id })) },
				},
			})),
			...opts.artists.map((a) => ({
				id: a.id,
				type: "artists",
				attributes: { name: a.name },
			})),
		],
		links: { self: "/x", ...(opts.next ? { next: opts.next } : {}) },
	};
}

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

describe("library auth gating", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("POST /api/library/sync without session -> 401", async () => {
		const res = await SELF.fetch("http://example.com/api/library/sync", {
			method: "POST",
		});
		expect(res.status).toBe(401);
	});

	it("GET /api/library/count without session -> 401", async () => {
		const res = await SELF.fetch("http://example.com/api/library/count");
		expect(res.status).toBe(401);
	});
});

describe("POST /api/library/sync", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("paginates, writes rows to D1, returns count", async () => {
		const { userId, cookie } = await seedAuthedUser();

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				libraryPage({
					items: [
						{ id: "t1", addedAt: "2026-01-01T00:00:00Z" },
						{ id: "t2", addedAt: "2026-01-02T00:00:00Z" },
					],
					tracks: [
						{ id: "t1", title: "Song One", artistIds: ["a1"] },
						{ id: "t2", title: "Song Two", artistIds: ["a2"] },
					],
					artists: [
						{ id: "a1", name: "Artist One" },
						{ id: "a2", name: "Artist Two" },
					],
					next: "/userCollectionTracks/me/relationships/items?page%5Bcursor%5D=p2",
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				libraryPage({
					items: [{ id: "t3", addedAt: "2026-01-03T00:00:00Z" }],
					tracks: [{ id: "t3", title: "Song Three", artistIds: ["a3"] }],
					artists: [{ id: "a3", name: "Artist Three" }],
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		const res = await SELF.fetch("http://example.com/api/library/sync", {
			method: "POST",
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ synced: 3 });

		const rows = await env.DB.prepare(
			"SELECT song_id, title, artist, added_at FROM library_songs WHERE user_id = ? ORDER BY song_id",
		)
			.bind(userId)
			.all<{ song_id: string; title: string; artist: string; added_at: number }>();
		expect(rows.results).toEqual([
			{
				song_id: "t1",
				title: "Song One",
				artist: "Artist One",
				added_at: Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000),
			},
			{
				song_id: "t2",
				title: "Song Two",
				artist: "Artist Two",
				added_at: Math.floor(Date.parse("2026-01-02T00:00:00Z") / 1000),
			},
			{
				song_id: "t3",
				title: "Song Three",
				artist: "Artist Three",
				added_at: Math.floor(Date.parse("2026-01-03T00:00:00Z") / 1000),
			},
		]);
	});

	it("retries on 429 then succeeds", async () => {
		const { userId, cookie } = await seedAuthedUser();

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(429, "", { headers: { "retry-after": "0" } });

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				libraryPage({
					items: [{ id: "t1" }],
					tracks: [{ id: "t1", title: "Only Song", artistIds: ["a1"] }],
					artists: [{ id: "a1", name: "Only Artist" }],
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		const res = await SELF.fetch("http://example.com/api/library/sync", {
			method: "POST",
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ synced: 1 });

		const count = await env.DB.prepare(
			"SELECT COUNT(*) AS n FROM library_songs WHERE user_id = ?",
		)
			.bind(userId)
			.first<{ n: number }>();
		expect(count?.n).toBe(1);
	});

	it("is idempotent: second sync updates synced_at, no duplicate rows", async () => {
		const { userId, cookie } = await seedAuthedUser();

		const body = libraryPage({
			items: [{ id: "t1", addedAt: "2026-01-01T00:00:00Z" }],
			tracks: [{ id: "t1", title: "Song One", artistIds: ["a1"] }],
			artists: [{ id: "a1", name: "Artist One" }],
		});

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(200, body, {
				headers: { "content-type": "application/vnd.api+json" },
			});

		const r1 = await SELF.fetch("http://example.com/api/library/sync", {
			method: "POST",
			headers: { cookie },
		});
		expect(r1.status).toBe(200);
		const firstRow = await env.DB.prepare(
			"SELECT synced_at FROM library_songs WHERE user_id = ? AND song_id = ?",
		)
			.bind(userId, "t1")
			.first<{ synced_at: number }>();
		expect(firstRow).toBeTruthy();

		// Re-arm the mock and ensure clock advances by at least 1 second.
		await new Promise((r) => setTimeout(r, 1100));

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(200, body, {
				headers: { "content-type": "application/vnd.api+json" },
			});

		const r2 = await SELF.fetch("http://example.com/api/library/sync", {
			method: "POST",
			headers: { cookie },
		});
		expect(r2.status).toBe(200);

		const all = await env.DB.prepare(
			"SELECT song_id, synced_at FROM library_songs WHERE user_id = ?",
		)
			.bind(userId)
			.all<{ song_id: string; synced_at: number }>();
		expect(all.results.length).toBe(1);
		expect(all.results[0].synced_at).toBeGreaterThan(firstRow!.synced_at);
	});

	async function seedStaleSong(userId: string, songId: string) {
		const old = Math.floor(Date.now() / 1000) - 1000;
		await env.DB.prepare(
			"INSERT INTO library_songs (user_id, song_id, title, artist, added_at, synced_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(userId, songId, "Gone", "Gone Artist", old, old)
			.run();
	}

	it("mirrors deletions: sweeps rows TIDAL no longer has when the fetch is complete", async () => {
		const { userId, cookie } = await seedAuthedUser();
		await seedStaleSong(userId, "stale");

		// Ground truth: collection now holds exactly 1 track.
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\?/ })
			.reply(
				200,
				{ data: { id: "me", type: "userCollectionTracks", attributes: { numberOfItems: 1 } } },
				{ headers: { "content-type": "application/vnd.api+json" } },
			);
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				libraryPage({
					items: [{ id: "t1" }],
					tracks: [{ id: "t1", title: "Kept", artistIds: ["a1"] }],
					artists: [{ id: "a1", name: "Kept Artist" }],
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		const res = await SELF.fetch("http://example.com/api/library/sync", {
			method: "POST",
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ synced: 1, removed: 1, complete: true });

		const rows = await env.DB.prepare(
			"SELECT song_id FROM library_songs WHERE user_id = ? ORDER BY song_id",
		)
			.bind(userId)
			.all<{ song_id: string }>();
		expect(rows.results.map((r) => r.song_id)).toEqual(["t1"]);
	});

	it("unions two passes (one sort each) into a complete, mirrored sync", async () => {
		const { userId, cookie } = await seedAuthedUser();

		// Collection has 3 tracks; probed once per pass (both passes see size 3).
		for (let i = 0; i < 2; i++) {
			fetchMock
				.get("https://openapi.tidal.com")
				.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\?/ })
				.reply(
					200,
					{ data: { id: "me", type: "userCollectionTracks", attributes: { numberOfItems: 3 } } },
					{ headers: { "content-type": "application/vnd.api+json" } },
				);
		}
		// Pass 0 (-addedAt) skips t3; pass 1 (title) skips t2 — neither sort alone
		// is complete, but their union is. t2 is found ONLY in pass 0, so it must
		// survive pass 1's mirror sweep (it shares the sync generation id).
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				libraryPage({
					items: [{ id: "t1" }, { id: "t2" }],
					tracks: [
						{ id: "t1", title: "Song One", artistIds: ["a1"] },
						{ id: "t2", title: "Song Two", artistIds: ["a2"] },
					],
					artists: [
						{ id: "a1", name: "Artist One" },
						{ id: "a2", name: "Artist Two" },
					],
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				libraryPage({
					items: [{ id: "t1" }, { id: "t3" }],
					tracks: [
						{ id: "t1", title: "Song One", artistIds: ["a1"] },
						{ id: "t3", title: "Song Three", artistIds: ["a3"] },
					],
					artists: [
						{ id: "a1", name: "Artist One" },
						{ id: "a3", name: "Artist Three" },
					],
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		const r0 = await SELF.fetch("http://example.com/api/library/sync?pass=0", {
			method: "POST",
			headers: { cookie },
		});
		const j0 = (await r0.json()) as { synced: number; complete: boolean; nextPass: number | null; syncId: number };
		expect(j0).toMatchObject({ synced: 2, complete: false, nextPass: 1 });

		const r1 = await SELF.fetch(
			`http://example.com/api/library/sync?pass=${j0.nextPass}&syncId=${j0.syncId}`,
			{ method: "POST", headers: { cookie } },
		);
		expect(await r1.json()).toMatchObject({ synced: 3, complete: true, nextPass: null });

		const rows = await env.DB.prepare(
			"SELECT song_id FROM library_songs WHERE user_id = ? ORDER BY song_id",
		)
			.bind(userId)
			.all<{ song_id: string }>();
		expect(rows.results.map((r) => r.song_id)).toEqual(["t1", "t2", "t3"]);
	});

	it("does not delete when the fetch is incomplete (collection size unknown)", async () => {
		const { userId, cookie } = await seedAuthedUser();
		await seedStaleSong(userId, "stale");

		// Probe is unmocked -> total null -> complete false -> no mirror sweep.
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				libraryPage({
					items: [{ id: "t1" }],
					tracks: [{ id: "t1", title: "Kept", artistIds: ["a1"] }],
					artists: [{ id: "a1", name: "Kept Artist" }],
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		const res = await SELF.fetch("http://example.com/api/library/sync", {
			method: "POST",
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ synced: 1, removed: 0, complete: false });

		const rows = await env.DB.prepare(
			"SELECT song_id FROM library_songs WHERE user_id = ? ORDER BY song_id",
		)
			.bind(userId)
			.all<{ song_id: string }>();
		expect(rows.results.map((r) => r.song_id)).toEqual(["stale", "t1"]);
	});
});

describe("GET /api/library/count", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("returns the row count for the authenticated user", async () => {
		const { userId, cookie } = await seedAuthedUser();
		const now = Math.floor(Date.now() / 1000);
		await env.DB.batch([
			env.DB.prepare(
				"INSERT INTO library_songs (user_id, song_id, title, artist, added_at, synced_at) VALUES (?, ?, ?, ?, ?, ?)",
			).bind(userId, "s1", "T1", "A1", now, now),
			env.DB.prepare(
				"INSERT INTO library_songs (user_id, song_id, title, artist, added_at, synced_at) VALUES (?, ?, ?, ?, ?, ?)",
			).bind(userId, "s2", "T2", "A2", now, now),
		]);

		const res = await SELF.fetch("http://example.com/api/library/count", {
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ count: 2 });
	});

	it("does not leak rows belonging to other users", async () => {
		const { cookie } = await seedAuthedUser();
		const otherUserId = crypto.randomUUID();
		await env.DB.prepare(
			"INSERT INTO users (id, tidal_user_id, created_at) VALUES (?, ?, ?)",
		)
			.bind(otherUserId, `tidal_${otherUserId}`, 0)
			.run();
		const now = Math.floor(Date.now() / 1000);
		await env.DB.prepare(
			"INSERT INTO library_songs (user_id, song_id, title, artist, added_at, synced_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(otherUserId, "x1", "T", "A", now, now)
			.run();

		const res = await SELF.fetch("http://example.com/api/library/count", {
			headers: { cookie },
		});
		expect(await res.json()).toEqual({ count: 0 });
	});
});
