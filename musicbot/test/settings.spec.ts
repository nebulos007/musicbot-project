import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, createSession } from "../src/lib/session";
import { byokKvKey, tokensKvKey } from "../src/lib/tidal";

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

describe("settings auth gating", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("GET /api/settings without session -> 401", async () => {
		const res = await SELF.fetch("http://example.com/api/settings");
		expect(res.status).toBe(401);
	});

	it("POST /api/settings without session -> 401", async () => {
		const res = await SELF.fetch("http://example.com/api/settings", {
			method: "POST",
			body: JSON.stringify({ key: "abc" }),
		});
		expect(res.status).toBe(401);
	});
});

describe("BYOK key round-trip", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("reports no key before one is saved", async () => {
		const { cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/settings", {
			headers: { cookie },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ hasKey: false, tidalConnected: true });
	});

	it("stores the key and reports hasKey afterwards", async () => {
		const { userId, cookie } = await seedAuthedUser();
		const save = await SELF.fetch("http://example.com/api/settings", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ key: "  secret-key-123  " }),
		});
		expect(save.status).toBe(200);

		// Trimmed and persisted to KV.
		expect(await env.SESSIONS.get(byokKvKey(userId))).toBe("secret-key-123");

		const status = await SELF.fetch("http://example.com/api/settings", {
			headers: { cookie },
		});
		expect(await status.json()).toEqual({ hasKey: true, tidalConnected: true });
	});

	it("never returns the raw key in any response", async () => {
		const { cookie } = await seedAuthedUser();
		await SELF.fetch("http://example.com/api/settings", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ key: "super-secret" }),
		});
		const status = await SELF.fetch("http://example.com/api/settings", {
			headers: { cookie },
		});
		expect(await status.text()).not.toContain("super-secret");
	});

	it("rejects an empty key with 400", async () => {
		const { cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/settings", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ key: "   " }),
		});
		expect(res.status).toBe(400);
	});
});
