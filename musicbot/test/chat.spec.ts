import { SELF, env, fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SESSION_COOKIE_NAME, createSession } from "../src/lib/session";
import { byokKvKey, tokensKvKey } from "../src/lib/tidal";

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
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS feedback_events (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, song_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT, artist TEXT, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
	);
	await env.DB.exec(
		"CREATE TABLE IF NOT EXISTS taste_profile_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, profile_json TEXT NOT NULL, created_at INTEGER NOT NULL, FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)",
	);
	await env.DB.exec("DELETE FROM taste_profile_snapshots");
	await env.DB.exec("DELETE FROM feedback_events");
	await env.DB.exec("DELETE FROM library_songs");
	await env.DB.exec("DELETE FROM sessions");
	await env.DB.exec("DELETE FROM users");
}

async function seedFeedback(
	userId: string,
	rows: Array<{ songId: string; kind: string; title: string; artist: string }>,
) {
	for (const r of rows) {
		await env.DB.prepare(
			"INSERT INTO feedback_events (user_id, song_id, kind, title, artist, created_at) VALUES (?, ?, ?, ?, ?, ?)",
		)
			.bind(userId, r.songId, r.kind, r.title, r.artist, Math.floor(Date.now() / 1000))
			.run();
	}
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

function geminiReply(reply: string, recs: Array<{ title: string; artist: string }>) {
	return {
		candidates: [
			{
				content: {
					parts: [{ text: JSON.stringify({ reply, recommendations: recs }) }],
				},
			},
		],
	};
}

// Minimal JSON:API search response with the cover-art include chain.
function searchHit(opts: {
	trackId: string;
	title: string;
	artist: string;
	album: string;
	coverHref: string;
}) {
	return {
		data: {
			id: "q",
			type: "searchResults",
			relationships: {
				tracks: { data: [{ type: "tracks", id: opts.trackId }] },
			},
		},
		included: [
			{
				type: "tracks",
				id: opts.trackId,
				attributes: { title: opts.title },
				relationships: {
					artists: { data: [{ type: "artists", id: "ar1" }] },
					albums: { data: [{ type: "albums", id: "al1" }] },
				},
			},
			{ type: "artists", id: "ar1", attributes: { name: opts.artist } },
			{
				type: "albums",
				id: "al1",
				attributes: { title: opts.album },
				// coverArt is to-one: `data` is a bare object, not an array.
				relationships: { coverArt: { data: { type: "artworks", id: "art1" } } },
			},
			{
				type: "artworks",
				id: "art1",
				attributes: {
					files: [{ href: opts.coverHref, meta: { width: 640, height: 640 } }],
				},
			},
		],
	};
}

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

describe("POST /api/chat gating", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("401 without a session", async () => {
		const res = await SELF.fetch("http://example.com/api/chat", {
			method: "POST",
			body: JSON.stringify({ prompt: "hi" }),
		});
		expect(res.status).toBe(401);
	});

	it("400 no_api_key when the user has not set a BYOK key", async () => {
		const { cookie } = await seedAuthedUser();
		const res = await SELF.fetch("http://example.com/api/chat", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ prompt: "something upbeat" }),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "no_api_key" });
	});

	it("400 missing_prompt for an empty prompt", async () => {
		const { userId, cookie } = await seedAuthedUser();
		await env.SESSIONS.put(byokKvKey(userId), "k");
		const res = await SELF.fetch("http://example.com/api/chat", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ prompt: "   " }),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "missing_prompt" });
	});
});

describe("POST /api/chat happy path", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	it("returns recs enriched with catalog title/artist/album art", async () => {
		const { userId, cookie } = await seedAuthedUser();
		await env.SESSIONS.put(byokKvKey(userId), "test-key");

		// Gemini returns two free-text recommendations.
		fetchMock
			.get("https://gateway.ai.cloudflare.com")
			.intercept({ method: "POST", path: /generateContent$/ })
			.reply(
				200,
				geminiReply("Here are a couple that fit.", [
					{ title: "Motion Sickness", artist: "Phoebe Bridgers" },
					{ title: "Kyoto", artist: "Phoebe Bridgers" },
				]),
			);

		// Two catalog searches resolve them to real tracks (FIFO by pathname).
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/searchResults\// })
			.reply(
				200,
				searchHit({
					trackId: "100",
					title: "Motion Sickness",
					artist: "Phoebe Bridgers",
					album: "Stranger in the Alps",
					coverHref: "https://art.tidal.com/100.jpg",
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/searchResults\// })
			.reply(
				200,
				searchHit({
					trackId: "200",
					title: "Kyoto",
					artist: "Phoebe Bridgers",
					album: "Punisher",
					coverHref: "https://art.tidal.com/200.jpg",
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		const res = await SELF.fetch("http://example.com/api/chat", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({
				prompt: "something like Phoebe Bridgers but more upbeat",
			}),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			reply: string;
			recommendations: Array<{
				id: string;
				title: string;
				artist: string;
				album?: string;
				albumArtUrl?: string;
			}>;
		};
		expect(json.reply).toBe("Here are a couple that fit.");
		expect(json.recommendations).toEqual([
			{
				id: "100",
				title: "Motion Sickness",
				artist: "Phoebe Bridgers",
				album: "Stranger in the Alps",
				albumArtUrl: "https://art.tidal.com/100.jpg",
			},
			{
				id: "200",
				title: "Kyoto",
				artist: "Phoebe Bridgers",
				album: "Punisher",
				albumArtUrl: "https://art.tidal.com/200.jpg",
			},
		]);
	});

	it("falls back to the LLM text when the catalog has no hit", async () => {
		const { userId, cookie } = await seedAuthedUser();
		await env.SESSIONS.put(byokKvKey(userId), "test-key");

		fetchMock
			.get("https://gateway.ai.cloudflare.com")
			.intercept({ method: "POST", path: /generateContent$/ })
			.reply(
				200,
				geminiReply("One pick.", [
					{ title: "Obscure Demo", artist: "Nobody" },
				]),
			);
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/searchResults\// })
			.reply(200, { data: { relationships: { tracks: { data: [] } } } }, {
				headers: { "content-type": "application/vnd.api+json" },
			});

		const res = await SELF.fetch("http://example.com/api/chat", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ prompt: "weird stuff" }),
		});
		expect(res.status).toBe(200);
		const json = (await res.json()) as {
			recommendations: Array<{ id: string; title: string; artist: string }>;
		};
		expect(json.recommendations).toEqual([
			{ id: "llm:0", title: "Obscure Demo", artist: "Nobody" },
		]);
	});
});

describe("POST /api/chat taste profile", () => {
	beforeEach(async () => {
		await resetDb();
		await clearKv();
	});

	// Intercepts the Gemini call and returns the request body it received — the
	// prompt is what the AI Gateway logs, so this is the verifiable surface for
	// "the prompt carries taste signals".
	function captureGeminiPrompt(): { read: () => string | undefined } {
		let body: string | undefined;
		fetchMock
			.get("https://gateway.ai.cloudflare.com")
			.intercept({ method: "POST", path: /generateContent$/ })
			.reply((opts) => {
				body = typeof opts.body === "string" ? opts.body : String(opts.body);
				return {
					statusCode: 200,
					data: geminiReply("ok", [{ title: "Anything", artist: "Someone" }]),
				};
			});
		// The single rec misses the catalog and falls back to an llm: id; we only
		// care about the prompt here.
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/searchResults\// })
			.reply(200, { data: { relationships: { tracks: { data: [] } } } }, {
				headers: { "content-type": "application/vnd.api+json" },
			});
		return { read: () => body };
	}

	async function chat(cookie: string, prompt: string) {
		return SELF.fetch("http://example.com/api/chat", {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ prompt }),
		});
	}

	it("sends the cold-start prompt (no taste block) when there is no feedback", async () => {
		const { userId, cookie } = await seedAuthedUser();
		await env.SESSIONS.put(byokKvKey(userId), "test-key");
		const cap = captureGeminiPrompt();

		const res = await chat(cookie, "anything");
		expect(res.status).toBe(200);
		expect(cap.read()).not.toContain("Taste profile");
	});

	it("enriches the prompt with loved + disliked signals after feedback, differing from cold start", async () => {
		const { userId, cookie } = await seedAuthedUser();
		await env.SESSIONS.put(byokKvKey(userId), "test-key");
		await seedFeedback(userId, [
			...Array.from({ length: 5 }, (_, i) => ({
				songId: `a${i}`,
				kind: "like",
				title: `Loved ${i}`,
				artist: "Alvvays",
			})),
			...Array.from({ length: 5 }, (_, i) => ({
				songId: `d${i}`,
				kind: "dislike",
				title: `Hated ${i}`,
				artist: "Imagine Dragons",
			})),
		]);
		const cap = captureGeminiPrompt();

		const res = await chat(cookie, "more like this");
		expect(res.status).toBe(200);

		const prompt = cap.read() ?? "";
		expect(prompt).toContain("Taste profile");
		expect(prompt).toContain("Alvvays"); // loved → lean into
		expect(prompt).toContain("Imagine Dragons"); // disliked → avoid

		// The profile that drove this request was snapshotted.
		const snap = await env.DB.prepare(
			"SELECT profile_json FROM taste_profile_snapshots WHERE user_id = ?",
		)
			.bind(userId)
			.all<{ profile_json: string }>();
		expect(snap.results.length).toBe(1);
		const profile = JSON.parse(snap.results[0].profile_json);
		expect(profile.lovedArtists).toContain("Alvvays");
		expect(profile.dislikedArtists).toContain("Imagine Dragons");
	});
});
