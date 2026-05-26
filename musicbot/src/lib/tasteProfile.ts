// Phase 4: derive a taste profile from explicit feedback.
//
// feedback_events is an append-only log; we take the *latest* signal per song
// (the Phase 3 contract — a toggle-off is visual-only, so the last recorded
// event wins). like/add are positive, dislike is negative. The output names
// real artists/tracks so the LLM prompt can lean into what the user likes and
// exclude what they don't — the cold-start "like X but different" weakness this
// phase targets. Genres/eras aren't derivable yet (D1 holds only title+artist;
// album/genre were deferred), so the profile is artist- and track-level only.

export type FeedbackKind = "like" | "dislike" | "add";

export type FeedbackEvent = {
	songId: string;
	kind: FeedbackKind;
	artist: string | null;
	title: string | null;
};

export type TasteProfile = {
	lovedArtists: string[]; // ranked by positive-signal count
	dislikedArtists: string[]; // disliked and never liked — safe to avoid wholesale
	dislikedTracks: string[]; // "Title — Artist", most-recent-first hard exclusions
};

const LOVED_ARTISTS_CAP = 15;
const DISLIKED_ARTISTS_CAP = 15;
const DISLIKED_TRACKS_CAP = 20;

function clean(value: string | null): string {
	return value?.trim() ?? "";
}

export function deriveTasteProfile(events: FeedbackEvent[]): TasteProfile {
	// Collapse to the latest event per song (events are oldest-first).
	const latest = new Map<string, FeedbackEvent>();
	for (const e of events) latest.set(e.songId, e);

	const lovedCounts = new Map<string, number>();
	const dislikedCounts = new Map<string, number>();
	// Most-recent-first, deduped.
	const dislikedTracks: string[] = [];
	const seenTracks = new Set<string>();

	for (const e of [...latest.values()].reverse()) {
		const artist = clean(e.artist);
		const positive = e.kind === "like" || e.kind === "add";

		if (positive) {
			if (artist) lovedCounts.set(artist, (lovedCounts.get(artist) ?? 0) + 1);
			continue;
		}

		// dislike
		if (artist) {
			dislikedCounts.set(artist, (dislikedCounts.get(artist) ?? 0) + 1);
		}
		const title = clean(e.title);
		if (title && artist) {
			const label = `${title} — ${artist}`;
			if (!seenTracks.has(label) && dislikedTracks.length < DISLIKED_TRACKS_CAP) {
				seenTracks.add(label);
				dislikedTracks.push(label);
			}
		}
	}

	const byCountThenName = (a: [string, number], b: [string, number]) =>
		b[1] - a[1] || a[0].localeCompare(b[0]);

	const lovedArtists = [...lovedCounts.entries()]
		.sort(byCountThenName)
		.slice(0, LOVED_ARTISTS_CAP)
		.map(([artist]) => artist);

	// Don't tell the LLM to avoid an artist the user also likes — check against
	// every loved artist, not just the capped top list.
	const lovedSet = new Set(lovedCounts.keys());
	const dislikedArtists = [...dislikedCounts.entries()]
		.filter(([artist]) => !lovedSet.has(artist))
		.sort(byCountThenName)
		.slice(0, DISLIKED_ARTISTS_CAP)
		.map(([artist]) => artist);

	return { lovedArtists, dislikedArtists, dislikedTracks };
}
