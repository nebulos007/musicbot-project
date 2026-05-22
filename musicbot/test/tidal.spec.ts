import { fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { fetchAllLibrary, fetchLibraryPage } from "../src/lib/tidal";

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

function pageBody(opts: {
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

describe("fetchLibraryPage 429 backoff", () => {
	it("retries after Retry-After seconds and returns the second response", async () => {
		const calls: number[] = [];

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(429, "", { headers: { "retry-after": "2" } });

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				pageBody({
					items: [{ id: "t1" }],
					tracks: [{ id: "t1", title: "After Hours", artistIds: ["a1"] }],
					artists: [{ id: "a1", name: "The Weeknd" }],
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		const page = await fetchLibraryPage(
			"/userCollectionTracks/me/relationships/items?include=items,items.artists&countryCode=US&locale=en-US",
			{
				accessToken: "tok",
				sleep: async (s) => {
					calls.push(s);
				},
			},
		);

		expect(calls).toEqual([2]);
		expect(page.songs).toEqual([
			{
				songId: "t1",
				title: "After Hours",
				artist: "The Weeknd",
				addedAt: Math.floor(Date.parse("2026-01-01T00:00:00Z") / 1000),
			},
		]);
		expect(page.nextPath).toBeNull();
	});

	it("falls back to a 1s wait when Retry-After is missing", async () => {
		const calls: number[] = [];

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(429, "");

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				pageBody({ items: [], tracks: [], artists: [] }),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		await fetchLibraryPage(
			"/userCollectionTracks/me/relationships/items?include=items,items.artists&countryCode=US&locale=en-US",
			{
				accessToken: "tok",
				sleep: async (s) => {
					calls.push(s);
				},
			},
		);
		expect(calls).toEqual([1]);
	});
});

describe("fetchAllLibrary pagination", () => {
	it("follows links.next until exhausted", async () => {
		// FIFO match: undici normalizes query params, so we match by pathname.
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				pageBody({
					items: [{ id: "t1" }],
					tracks: [{ id: "t1", title: "Song 1", artistIds: ["a1"] }],
					artists: [{ id: "a1", name: "Artist 1" }],
					next: "/userCollectionTracks/me/relationships/items?include=items,items.artists&page%5Bcursor%5D=p2",
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "GET", path: /^\/v2\/userCollectionTracks\/me\/relationships\/items/ })
			.reply(
				200,
				pageBody({
					items: [{ id: "t2" }],
					tracks: [{ id: "t2", title: "Song 2", artistIds: ["a2"] }],
					artists: [{ id: "a2", name: "Artist 2" }],
				}),
				{ headers: { "content-type": "application/vnd.api+json" } },
			);

		const songs = await fetchAllLibrary({ accessToken: "tok", sleep: async () => {} });
		expect(songs.map((s) => s.songId)).toEqual(["t1", "t2"]);
		expect(songs.map((s) => s.artist)).toEqual(["Artist 1", "Artist 2"]);
	});
});
