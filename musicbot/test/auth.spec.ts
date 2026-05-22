import { SELF, env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pkceKvKey, tokensKvKey } from "../src/lib/tidal";

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

function base64UrlEncode(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(input: string): Promise<string> {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(input),
	);
	return base64UrlEncode(new Uint8Array(digest));
}

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

describe("GET /api/auth/login", () => {
	beforeEach(async () => {
		await clearKv();
	});

	it("redirects to TIDAL with PKCE challenge + state, and stores the verifier in KV", async () => {
		const res = await SELF.fetch("http://example.com/api/auth/login", {
			redirect: "manual",
		});
		expect(res.status).toBe(302);

		const location = res.headers.get("location");
		expect(location).toBeTruthy();
		const url = new URL(location!);
		expect(url.origin + url.pathname).toBe("https://login.tidal.com/authorize");
		expect(url.searchParams.get("response_type")).toBe("code");
		expect(url.searchParams.get("code_challenge_method")).toBe("S256");
		expect(url.searchParams.get("redirect_uri")).toBe(
			"http://example.com/api/auth/callback",
		);
		expect(url.searchParams.get("scope")).toBe(
			"user.read collection.read collection.write",
		);
		expect(url.searchParams.get("client_id")).toBeTruthy();

		const state = url.searchParams.get("state");
		const challenge = url.searchParams.get("code_challenge");
		expect(state).toBeTruthy();
		expect(challenge).toBeTruthy();

		const stored = (await env.SESSIONS.get(pkceKvKey(state!), "json")) as
			| { verifier: string }
			| null;
		expect(stored?.verifier).toBeTruthy();
		expect(await sha256Base64Url(stored!.verifier)).toBe(challenge);
	});
});

describe("GET /api/auth/callback", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("rejects when code or state is missing", async () => {
		const res = await SELF.fetch(
			"http://example.com/api/auth/callback?state=abc",
			{ redirect: "manual" },
		);
		expect(res.status).toBe(400);
	});

	it("rejects when state has no matching KV entry", async () => {
		const res = await SELF.fetch(
			"http://example.com/api/auth/callback?code=c&state=unknown-state",
			{ redirect: "manual" },
		);
		expect(res.status).toBe(400);
	});

	it("on success: exchanges code, creates user, stores tokens, sets session cookie, redirects to /", async () => {
		const state = "test-state-123";
		const verifier = "test-verifier-abcdef-0123456789";
		await env.SESSIONS.put(
			pkceKvKey(state),
			JSON.stringify({ verifier, createdAt: 0 }),
		);

		fetchMock
			.get("https://auth.tidal.com")
			.intercept({ method: "POST", path: "/v1/oauth2/token" })
			.reply(
				200,
				{
					access_token: "fake-access-token",
					refresh_token: "fake-refresh-token",
					expires_in: 3600,
					scope: "user.read collection.read collection.write",
					token_type: "Bearer",
				},
				{ headers: { "content-type": "application/json" } },
			);

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: "/v2/users/me" })
			.reply(
				200,
				{ data: { id: "tidal-user-42" } },
				{ headers: { "content-type": "application/json" } },
			);

		const res = await SELF.fetch(
			`http://example.com/api/auth/callback?code=fake-code&state=${state}`,
			{ redirect: "manual" },
		);

		expect(res.status).toBe(302);
		expect(res.headers.get("location")).toBe("/");

		const setCookie = res.headers.get("set-cookie");
		expect(setCookie).toContain("mb_session=");
		expect(setCookie?.toLowerCase()).toContain("httponly");
		expect(setCookie?.toLowerCase()).toContain("samesite=lax");

		const user = await env.DB.prepare(
			"SELECT id, tidal_user_id FROM users WHERE tidal_user_id = ?",
		)
			.bind("tidal-user-42")
			.first<{ id: string; tidal_user_id: string }>();
		expect(user).toBeTruthy();

		const tokens = (await env.SESSIONS.get(
			tokensKvKey(user!.id),
			"json",
		)) as { accessToken: string; refreshToken: string } | null;
		expect(tokens?.accessToken).toBe("fake-access-token");
		expect(tokens?.refreshToken).toBe("fake-refresh-token");

		const session = await env.DB.prepare(
			"SELECT user_id FROM sessions WHERE user_id = ?",
		)
			.bind(user!.id)
			.first<{ user_id: string }>();
		expect(session?.user_id).toBe(user!.id);

		const pkceEntry = await env.SESSIONS.get(pkceKvKey(state));
		expect(pkceEntry).toBeNull();
	});

	it("reuses an existing user row when the same tidal_user_id signs in again", async () => {
		const state = "second-login-state";
		await env.SESSIONS.put(
			pkceKvKey(state),
			JSON.stringify({ verifier: "v", createdAt: 0 }),
		);

		const existingUserId = "pre-existing-uuid";
		await env.DB.prepare(
			"INSERT INTO users (id, tidal_user_id, created_at) VALUES (?, ?, ?)",
		)
			.bind(existingUserId, "tidal-user-99", 0)
			.run();

		fetchMock
			.get("https://auth.tidal.com")
			.intercept({ method: "POST", path: "/v1/oauth2/token" })
			.reply(
				200,
				{
					access_token: "a2",
					refresh_token: "r2",
					expires_in: 3600,
					scope: "x",
					token_type: "Bearer",
				},
				{ headers: { "content-type": "application/json" } },
			);

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: "/v2/users/me" })
			.reply(
				200,
				{ data: { id: "tidal-user-99" } },
				{ headers: { "content-type": "application/json" } },
			);

		const res = await SELF.fetch(
			`http://example.com/api/auth/callback?code=c2&state=${state}`,
			{ redirect: "manual" },
		);
		expect(res.status).toBe(302);

		const userRows = await env.DB.prepare(
			"SELECT id FROM users WHERE tidal_user_id = ?",
		)
			.bind("tidal-user-99")
			.all<{ id: string }>();
		expect(userRows.results.length).toBe(1);
		expect(userRows.results[0].id).toBe(existingUserId);
	});
});
