import { SELF, env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, createSession } from "../src/lib/session";
import { tokensKvKey } from "../src/lib/tidal";

const ITEMS_PATH = /^\/v2\/userCollectionTracks\/me\/relationships\/items/;

async function resetDb() {
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tidal_user_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS feedback_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, song_id TEXT NOT NULL, kind TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
	);
	await env.DB.exec("DELETE FROM feedback_events");
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
	// Fresh token so refreshIfNeeded skips the refresh round-trip.
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

function eventsFor(userId: string) {
	return env.DB.prepare(
		"SELECT song_id, kind, created_at FROM feedback_events WHERE user_id = ?",
	)
		.bind(userId)
		.all<{ song_id: string; kind: string; created_at: number }>();
}

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

describe("feedback auth gating", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("POST /api/feedback without session -> 401", async () => {
		const res = await SELF.fetch("http://example.com/api/feedback", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ songId: "s1", kind: "like" }),
		});
		expect(res.status).toBe(401);
	});
});

describe("POST /api/feedback", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("records a like event", async () => {
		const { userId, cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/feedback", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ songId: "s1", kind: "like" }),
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });

		const rows = await eventsFor(userId);
		expect(rows.results.length).toBe(1);
		expect(rows.results[0]).toMatchObject({ song_id: "s1", kind: "like" });
		expect(typeof rows.results[0].created_at).toBe("number");
	});

	it("records a dislike event", async () => {
		const { userId, cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/feedback", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ songId: "s2", kind: "dislike" }),
		});
		expect(res.status).toBe(200);

		const rows = await eventsFor(userId);
		expect(rows.results).toMatchObject([{ song_id: "s2", kind: "dislike" }]);
	});

	it("rejects an unknown kind with 400 and writes nothing", async () => {
		const { userId, cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/feedback", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ songId: "s1", kind: "love" }),
		});
		expect(res.status).toBe(400);
		const rows = await eventsFor(userId);
		expect(rows.results.length).toBe(0);
	});

	it("rejects a missing songId with 400", async () => {
		const { cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/feedback", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ kind: "like" }),
		});
		expect(res.status).toBe(400);
	});

	it("add: calls TIDAL addToLibrary then records the event", async () => {
		const { userId, cookie } = await seedAuthedUser();

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "POST", path: ITEMS_PATH })
			.reply(200, "");

		const res = await SELF.fetch("http://example.com/api/feedback", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ songId: "42", kind: "add" }),
		});
		expect(res.status).toBe(200);

		const rows = await eventsFor(userId);
		expect(rows.results).toMatchObject([{ song_id: "42", kind: "add" }]);
	});

	it("add: returns 502 and records no event when TIDAL rejects", async () => {
		const { userId, cookie } = await seedAuthedUser();

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "POST", path: ITEMS_PATH })
			.reply(500, "boom");

		const res = await SELF.fetch("http://example.com/api/feedback", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ songId: "42", kind: "add" }),
		});
		expect(res.status).toBe(502);

		const rows = await eventsFor(userId);
		expect(rows.results.length).toBe(0);
	});
});
