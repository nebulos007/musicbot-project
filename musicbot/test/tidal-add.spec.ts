import { fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { addToLibrary } from "../src/lib/tidal";

const ITEMS_PATH = /^\/v2\/userCollectionTracks\/me\/relationships\/items/;

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

describe("addToLibrary", () => {
	it("POSTs a JSON:API track identifier and resolves on 200", async () => {
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({
				method: "POST",
				path: ITEMS_PATH,
				body: '{"data":[{"type":"tracks","id":"12345"}]}',
			})
			.reply(200, "");

		await expect(
			addToLibrary("12345", { accessToken: "tok" }),
		).resolves.toBeUndefined();
	});

	it("retries on 429 then succeeds", async () => {
		const calls: number[] = [];

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "POST", path: ITEMS_PATH })
			.reply(429, "", { headers: { "retry-after": "2" } });

		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "POST", path: ITEMS_PATH })
			.reply(200, "");

		await addToLibrary("12345", {
			accessToken: "tok",
			sleep: async (s) => {
				calls.push(s);
			},
		});
		expect(calls).toEqual([2]);
	});

	it("treats 409 (already in collection) as success", async () => {
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "POST", path: ITEMS_PATH })
			.reply(409, "");

		await expect(
			addToLibrary("12345", { accessToken: "tok" }),
		).resolves.toBeUndefined();
	});

	it("throws on a non-retryable error", async () => {
		fetchMock
			.get("https://openapi.tidal.com")
			.intercept({ method: "POST", path: ITEMS_PATH })
			.reply(500, "boom");

		await expect(
			addToLibrary("12345", { accessToken: "tok" }),
		).rejects.toThrow(/500/);
	});
});
