import { Hono } from "hono";
import { generateRecommendations } from "../lib/llm";
import {
	buildRecommendationPrompt,
	summarizeLibrary,
} from "../lib/promptTemplates";
import { type SessionVariables, requireSession } from "../lib/session";
import { byokKvKey, refreshIfNeeded, searchTrack } from "../lib/tidal";

export const chatRouter = new Hono<{
	Bindings: Env;
	Variables: SessionVariables;
}>();

// Cap the number of recs we resolve against the catalog: 1 LLM call + N catalog
// searches stays well under the Worker's 50-subrequest limit (BUILDPLAN 1c note).
const MAX_RECS = 5;

export type ChatRecommendation = {
	id: string;
	title: string;
	artist: string;
	album?: string;
	albumArtUrl?: string;
};

chatRouter.use("*", requireSession());

chatRouter.post("/", async (c) => {
	const userId = c.get("userId");

	const body = await c.req
		.json<{ prompt?: string }>()
		.catch(() => ({}) as { prompt?: string });
	const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
	if (!prompt) return c.json({ error: "missing_prompt" }, 400);

	const apiKey = await c.env.SESSIONS.get(byokKvKey(userId));
	if (!apiKey) return c.json({ error: "no_api_key" }, 400);

	const lib = await c.env.DB.prepare(
		"SELECT title, artist FROM library_songs WHERE user_id = ?",
	)
		.bind(userId)
		.all<{ title: string; artist: string }>();

	const { system, user } = buildRecommendationPrompt({
		librarySummary: summarizeLibrary(lib.results ?? []),
		userPrompt: prompt,
		count: MAX_RECS,
	});

	const result = await generateRecommendations({
		apiKey,
		gatewayBaseUrl: c.env.AI_GATEWAY_BASE_URL,
		gatewayToken: c.env.AI_GATEWAY_TOKEN,
		system,
		user,
	});

	// Resolve each free-text rec to a real catalog track (title/artist/art + id).
	const recs = result.recommendations.slice(0, MAX_RECS);
	const accessToken = await refreshIfNeeded(c.env, userId);
	const recommendations: ChatRecommendation[] = await Promise.all(
		recs.map(async (r, i) => {
			const hit = await searchTrack(`${r.title} ${r.artist}`, accessToken);
			if (!hit) return { id: `llm:${i}`, title: r.title, artist: r.artist };
			return {
				id: hit.tidalId,
				title: hit.title,
				artist: hit.artist,
				...(hit.album ? { album: hit.album } : {}),
				...(hit.albumArtUrl ? { albumArtUrl: hit.albumArtUrl } : {}),
			};
		}),
	);

	return c.json({ reply: result.reply, recommendations });
});
