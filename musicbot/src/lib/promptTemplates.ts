// Prompt construction for the recommendation LLM call.
//
// We send a *summary* of the library, never the whole thing: a large library
// would blow the prompt's token budget and cost the user money on their own
// key. In Phase 2 the only signal D1 holds is title + artist (album/genre are
// NULL until later phases), so the summary is total count + most-collected
// artists. Phase 4 enriches this with a derived taste profile.

import type { TasteProfile } from "./tasteProfile";

// These two are coupled: each "Artist (n)" entry is ~20 chars, so the char cap
// is the real ceiling on how many artists reach the model. Raising TOP_ARTISTS
// without raising the cap just truncates the list mid-way. 150 artists gives the
// LLM enough breadth to infer genre/era clusters (see system prompt) while
// staying trivially cheap on the user's BYOK token budget.
export const MAX_SUMMARY_CHARS = 6000;
const TOP_ARTISTS = 150;

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

// A profile with no signal yet (cold start) is omitted entirely, so the prompt
// is byte-for-byte the pre-Phase-4 prompt until the first feedback lands.
function formatTasteProfile(p: TasteProfile): string {
	const lines = ["Taste profile derived from the user's feedback:"];
	if (p.lovedArtists.length) {
		lines.push(
			`- Lean into artists they've liked or added: ${p.lovedArtists.join(", ")}.`,
		);
	}
	if (p.dislikedArtists.length) {
		lines.push(
			`- Avoid these artists they disliked: ${p.dislikedArtists.join(", ")}.`,
		);
	}
	if (p.dislikedTracks.length) {
		lines.push(
			`- Never recommend these exact tracks (already disliked): ${p.dislikedTracks.join("; ")}.`,
		);
	}
	return lines.join("\n");
}

function hasSignal(p?: TasteProfile): p is TasteProfile {
	return (
		!!p &&
		(p.lovedArtists.length > 0 ||
			p.dislikedArtists.length > 0 ||
			p.dislikedTracks.length > 0)
	);
}

export function buildRecommendationPrompt(params: {
	librarySummary: string;
	userPrompt: string;
	count: number;
	tasteProfile?: TasteProfile;
}): { system: string; user: string } {
	const profile = hasSignal(params.tasteProfile)
		? params.tasteProfile
		: undefined;

	let system =
		`You are a knowledgeable music recommender inside a TIDAL discovery app. ` +
		`Given a summary of the user's library and a request, suggest exactly ${params.count} songs that fit the request. ` +
		`Favor artists or songs the user does not already appear to have. ` +
		`From the library summary, infer the genres, scenes, and eras (by decade) the user gravitates toward ` +
		`and the threads that connect their artists. Use those patterns when you recommend: match the dominant ` +
		`genres and eras for open-ended requests, and deliberately stretch along one axis — an adjacent scene, ` +
		`an earlier influence, or a contemporary descendant — when the request asks for something like an artist but different. ` +
		`Respond only as JSON matching the provided schema: a short, friendly "reply" (one or two sentences) ` +
		`and a "recommendations" array of objects with "title" and "artist".`;

	if (profile) {
		system +=
			` Use the taste profile to make "similar to" requests more adventurous — reach past the obvious. ` +
			`Never recommend an artist or exact track the profile says to avoid.`;
	}

	let user = `Library summary:\n${params.librarySummary}`;
	if (profile) {
		user += `\n\n${formatTasteProfile(profile)}`;
	}
	user += `\n\nRequest: ${params.userPrompt}`;

	return { system, user };
}
