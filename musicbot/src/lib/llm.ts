// BYOK Gemini call via Cloudflare AI Gateway.
//
// The gateway base URL (env.AI_GATEWAY_BASE_URL) ends at the gateway slug; we
// append the Google AI Studio provider path. The user's own key rides in the
// `x-goog-api-key` header — no charges flow through the developer's account,
// and AI Gateway adds logging + rate limiting for free (PRD §6).

export const GEMINI_MODEL = "gemini-2.5-flash";

export type RawRecommendation = { title: string; artist: string };
export type LlmResult = { reply: string; recommendations: RawRecommendation[] };

export function buildGatewayUrl(base: string): string {
	// v1beta, not v1: the stable /v1 GenerationConfig lacks responseMimeType /
	// responseSchema (Google rejects them as unknown fields). Structured output
	// lives on v1beta.
	return `${base.replace(/\/+$/, "")}/google-ai-studio/v1beta/models/${GEMINI_MODEL}:generateContent`;
}

// Asks Gemini to return JSON in this exact shape, so we don't have to scrape
// free-text. responseMimeType + responseSchema is Gemini's structured-output mode.
const RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		reply: { type: "string" },
		recommendations: {
			type: "array",
			items: {
				type: "object",
				properties: {
					title: { type: "string" },
					artist: { type: "string" },
				},
				required: ["title", "artist"],
			},
		},
	},
	required: ["reply", "recommendations"],
} as const;

type GeminiResponse = {
	candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
};

export async function generateRecommendations(params: {
	apiKey: string;
	gatewayBaseUrl: string;
	system: string;
	user: string;
	gatewayToken?: string;
}): Promise<LlmResult> {
	if (!params.apiKey) throw new Error("Missing LLM API key");

	const headers: Record<string, string> = {
		"content-type": "application/json",
		"x-goog-api-key": params.apiKey,
	};
	// Only sent when the gateway is configured as authenticated; an empty token
	// means an open gateway and no header (keeps tests and local dev working).
	if (params.gatewayToken) {
		headers["cf-aig-authorization"] = `Bearer ${params.gatewayToken}`;
	}

	const res = await fetch(buildGatewayUrl(params.gatewayBaseUrl), {
		method: "POST",
		headers,
		body: JSON.stringify({
			systemInstruction: { parts: [{ text: params.system }] },
			contents: [{ role: "user", parts: [{ text: params.user }] }],
			generationConfig: {
				responseMimeType: "application/json",
				responseSchema: RESPONSE_SCHEMA,
			},
		}),
	});
	if (!res.ok) {
		throw new Error(`Gemini call failed: ${res.status} ${await res.text()}`);
	}

	const json = (await res.json()) as GeminiResponse;
	const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!text) throw new Error("Gemini response missing text");

	const parsed = JSON.parse(text) as Partial<LlmResult>;
	return {
		reply: typeof parsed.reply === "string" ? parsed.reply : "",
		recommendations: Array.isArray(parsed.recommendations)
			? parsed.recommendations
					.filter(
						(r): r is RawRecommendation =>
							!!r &&
							typeof r.title === "string" &&
							typeof r.artist === "string",
					)
					.map((r) => ({ title: r.title, artist: r.artist }))
			: [],
	};
}
