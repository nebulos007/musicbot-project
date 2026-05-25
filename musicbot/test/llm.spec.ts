import { fetchMock } from "cloudflare:test";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
	GEMINI_MODEL,
	buildGatewayUrl,
	generateRecommendations,
} from "../src/lib/llm";

const BASE = "https://gateway.ai.cloudflare.com/v1/acct/test-gw";

beforeAll(() => {
	fetchMock.activate();
	fetchMock.disableNetConnect();
});

afterEach(() => {
	fetchMock.assertNoPendingInterceptors();
});

describe("buildGatewayUrl", () => {
	it("appends the google-ai-studio v1beta generateContent path", () => {
		expect(buildGatewayUrl(BASE)).toBe(
			`${BASE}/google-ai-studio/v1beta/models/${GEMINI_MODEL}:generateContent`,
		);
	});

	it("strips a trailing slash on the base", () => {
		expect(buildGatewayUrl(`${BASE}/`)).toBe(
			`${BASE}/google-ai-studio/v1beta/models/${GEMINI_MODEL}:generateContent`,
		);
	});
});

describe("generateRecommendations", () => {
	it("throws when the API key is missing", async () => {
		await expect(
			generateRecommendations({
				apiKey: "",
				gatewayBaseUrl: BASE,
				system: "s",
				user: "u",
			}),
		).rejects.toThrow(/api key/i);
	});

	it("parses the structured JSON out of the Gemini response", async () => {
		const payload = {
			reply: "Here are a few.",
			recommendations: [
				{ title: "Motion Sickness", artist: "Phoebe Bridgers" },
				{ title: "Kyoto", artist: "Phoebe Bridgers" },
			],
		};
		fetchMock
			.get("https://gateway.ai.cloudflare.com")
			.intercept({ method: "POST", path: /generateContent$/ })
			.reply(200, {
				candidates: [
					{ content: { parts: [{ text: JSON.stringify(payload) }] } },
				],
			});

		const out = await generateRecommendations({
			apiKey: "k",
			gatewayBaseUrl: BASE,
			system: "s",
			user: "u",
		});
		expect(out).toEqual(payload);
	});

	it("sends cf-aig-authorization only when a gateway token is given", async () => {
		// Intercept requires the header to match; if it isn't sent the interceptor
		// stays pending and assertNoPendingInterceptors() fails this test.
		fetchMock
			.get("https://gateway.ai.cloudflare.com")
			.intercept({
				method: "POST",
				path: /generateContent$/,
				headers: { "cf-aig-authorization": "Bearer gw-token" },
			})
			.reply(200, {
				candidates: [
					{
						content: {
							parts: [{ text: JSON.stringify({ reply: "", recommendations: [] }) }],
						},
					},
				],
			});

		await generateRecommendations({
			apiKey: "k",
			gatewayBaseUrl: BASE,
			gatewayToken: "gw-token",
			system: "s",
			user: "u",
		});
	});

	it("drops malformed recommendation entries", async () => {
		const text = JSON.stringify({
			reply: "ok",
			recommendations: [
				{ title: "Good", artist: "Artist" },
				{ title: "Missing artist" },
				{ artist: "Missing title" },
			],
		});
		fetchMock
			.get("https://gateway.ai.cloudflare.com")
			.intercept({ method: "POST", path: /generateContent$/ })
			.reply(200, {
				candidates: [{ content: { parts: [{ text }] } }],
			});

		const out = await generateRecommendations({
			apiKey: "k",
			gatewayBaseUrl: BASE,
			system: "s",
			user: "u",
		});
		expect(out.recommendations).toEqual([{ title: "Good", artist: "Artist" }]);
	});
});
