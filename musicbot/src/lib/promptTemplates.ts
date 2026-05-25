// Prompt construction for the recommendation LLM call.
//
// We send a *summary* of the library, never the whole thing: a large library
// would blow the prompt's token budget and cost the user money on their own
// key. In Phase 2 the only signal D1 holds is title + artist (album/genre are
// NULL until later phases), so the summary is total count + most-collected
// artists. Phase 4 enriches this with a derived taste profile.

export const MAX_SUMMARY_CHARS = 3000;
const TOP_ARTISTS = 40;

export type LibrarySongLite = { title: string; artist: string };

export function summarizeLibrary(songs: LibrarySongLite[]): string {
	const counts = new Map<string, number>();
	for (const s of songs) {
		counts.set(s.artist, (counts.get(s.artist) ?? 0) + 1);
	}

	const top = [...counts.entries()]
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.slice(0, TOP_ARTISTS)
		.map(([artist, n]) => `${artist} (${n})`);

	let summary =
		`The user has ${songs.length} songs in their library. ` +
		`Their most-collected artists: ${top.join(", ")}.`;

	if (summary.length > MAX_SUMMARY_CHARS) {
		summary = `${summary.slice(0, MAX_SUMMARY_CHARS - 1)}…`;
	}
	return summary;
}

export function buildRecommendationPrompt(params: {
	librarySummary: string;
	userPrompt: string;
	count: number;
}): { system: string; user: string } {
	const system =
		`You are a knowledgeable music recommender inside a TIDAL discovery app. ` +
		`Given a summary of the user's library and a request, suggest exactly ${params.count} songs that fit the request. ` +
		`Favor artists or songs the user does not already appear to have. ` +
		`Respond only as JSON matching the provided schema: a short, friendly "reply" (one or two sentences) ` +
		`and a "recommendations" array of objects with "title" and "artist".`;

	const user =
		`Library summary:\n${params.librarySummary}\n\n` +
		`Request: ${params.userPrompt}`;

	return { system, user };
}
