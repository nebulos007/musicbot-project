import { env, SELF } from "cloudflare:test";
import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";
import {
	SESSION_COOKIE_NAME,
	createSession,
	requireSession,
} from "../src/lib/session";

async function resetDb() {
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, tidal_user_id TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
	);
	await env.DB.exec("DELETE FROM sessions");
	await env.DB.exec("DELETE FROM users");
}

async function seedUser(id = "u_test"): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	await env.DB.prepare(
		"INSERT INTO users (id, tidal_user_id, created_at) VALUES (?, ?, ?)",
	)
		.bind(id, `tidal_${id}`, now)
		.run();
	return id;
}

function appWithRequireSession() {
	const app = new Hono<{
		Bindings: Env;
		Variables: { userId: string; sessionId: string };
	}>();
	app.use("/protected/*", requireSession());
	app.get("/protected/me", (c) =>
		c.json({ userId: c.get("userId"), sessionId: c.get("sessionId") }),
	);
	return app;
}

describe("session middleware", () => {
	beforeEach(async () => {
		await resetDb();
	});

	it("rejects requests with no cookie", async () => {
		const app = appWithRequireSession();
		const res = await app.request("/protected/me", {}, env);
		expect(res.status).toBe(401);
	});

	it("rejects an invalid cookie (no matching session row)", async () => {
		const app = appWithRequireSession();
		const res = await app.request(
			"/protected/me",
			{ headers: { cookie: `${SESSION_COOKIE_NAME}=does-not-exist` } },
			env,
		);
		expect(res.status).toBe(401);
	});

	it("rejects an expired cookie", async () => {
		const userId = await seedUser();
		const past = Math.floor(Date.now() / 1000) - 60;
		await env.DB.prepare(
			"INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
		)
			.bind("expired-sid", userId, past - 3600, past)
			.run();

		const app = appWithRequireSession();
		const res = await app.request(
			"/protected/me",
			{ headers: { cookie: `${SESSION_COOKIE_NAME}=expired-sid` } },
			env,
		);
		expect(res.status).toBe(401);
	});

	it("accepts a valid cookie and exposes userId + sessionId", async () => {
		const userId = await seedUser();
		const { id: sessionId } = await createSession(env.DB, userId);

		const app = appWithRequireSession();
		const res = await app.request(
			"/protected/me",
			{ headers: { cookie: `${SESSION_COOKIE_NAME}=${sessionId}` } },
			env,
		);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ userId, sessionId });
	});

	it("createSession writes a row with a future expires_at", async () => {
		const userId = await seedUser();
		const { id, expiresAt } = await createSession(env.DB, userId);
		const now = Math.floor(Date.now() / 1000);
		expect(expiresAt).toBeGreaterThan(now);
		const row = await env.DB.prepare(
			"SELECT user_id, expires_at FROM sessions WHERE id = ?",
		)
			.bind(id)
			.first<{ user_id: string; expires_at: number }>();
		expect(row?.user_id).toBe(userId);
		expect(row?.expires_at).toBe(expiresAt);
	});
});
