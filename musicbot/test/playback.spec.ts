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
		"CREATE TABLE IF NOT EXISTS listen_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, song_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT, artist TEXT, ms_played INTEGER, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
	);
	await env.DB.exec("DELETE FROM listen_events");
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
	// Fresh token so refreshIfNeeded skips the refresh round-trip (no fetch).
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

function listenEventsFor(userId: string) {
	return env.DB.prepare(
		"SELECT song_id, kind, title, artist, ms_played FROM listen_events WHERE user_id = ?",
	)
		.bind(userId)
		.all<{
			song_id: string;
			kind: string;
			title: string | null;
			artist: string | null;
			ms_played: number | null;
		}>();
}

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

describe("GET /api/playback/token", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("without a session -> 401", async () => {
		const res = await SELF.fetch("http://example.com/api/playback/token");
		expect(res.status).toBe(401);
	});

	it("mints and returns an app (client-credentials) token", async () => {
		const { cookie } = await seedAuthedUser();
		// The endpoint mints an app token via the client_credentials grant.
		fetchMock
			.get("https://auth.tidal.com")
			.intercept({ method: "POST", path: "/v1/oauth2/token" })
			.reply(200, {
				access_token: "app-token-xyz",
				token_type: "Bearer",
				expires_in: 14400,
				scope: "",
			});

		const res = await SELF.fetch("http://example.com/api/playback/token", {
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			accessToken: string;
			expiresAt: number;
			userId: string | null;
		};
		expect(body.accessToken).toBe("app-token-xyz");
		expect(body.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
		expect(body.userId).toBeNull();
	});
});

describe("POST /api/playback/listen", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("without a session -> 401", async () => {
		const res = await SELF.fetch("http://example.com/api/playback/listen", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ songId: "42", kind: "play_complete" }),
		});
		expect(res.status).toBe(401);
	});

	it("records a play_complete event with title/artist/ms_played", async () => {
		const { userId, cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/playback/listen", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				songId: "42",
				kind: "play_complete",
				title: "Archie, Marry Me",
				artist: "Alvvays",
				msPlayed: 198000,
			}),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });

		const rows = await listenEventsFor(userId);
		expect(rows.results).toMatchObject([
			{
				song_id: "42",
				kind: "play_complete",
				title: "Archie, Marry Me",
				artist: "Alvvays",
				ms_played: 198000,
			},
		]);
	});

	it("records a skip event", async () => {
		const { userId, cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/playback/listen", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ songId: "7", kind: "skip", msPlayed: 4000 }),
		});
		expect(res.status).toBe(200);
		const rows = await listenEventsFor(userId);
		expect(rows.results).toMatchObject([{ song_id: "7", kind: "skip" }]);
	});

	it("rejects an unknown kind with 400 and writes nothing", async () => {
		const { userId, cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/playback/listen", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ songId: "42", kind: "pause" }),
		});
		expect(res.status).toBe(400);
		const rows = await listenEventsFor(userId);
		expect(rows.results.length).toBe(0);
	});

	it("rejects a missing songId with 400", async () => {
		const { cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/playback/listen", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ kind: "play_complete" }),
		});
		expect(res.status).toBe(400);
	});
});
