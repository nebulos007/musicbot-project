import { describe, expect, it } from "vitest";
import {
	type FeedbackEvent,
	deriveTasteProfile,
} from "../src/lib/tasteProfile";

// Events arrive oldest-first (ascending id), the order chat.ts queries them in.
function ev(
	songId: string,
	kind: FeedbackEvent["kind"],
	artist: string | null,
	title: string | null,
): FeedbackEvent {
	return { songId, kind, artist, title };
}

describe("deriveTasteProfile", () => {
	it("returns an empty profile for no feedback", () => {
		expect(deriveTasteProfile([])).toEqual({
			lovedArtists: [],
			dislikedArtists: [],
			dislikedTracks: [],
		});
	});

	it("ranks loved artists by how often they were liked or added", () => {
		const profile = deriveTasteProfile([
			ev("1", "like", "Alvvays", "Archie, Marry Me"),
			ev("2", "add", "Alvvays", "Dreams Tonite"),
			ev("3", "like", "Snail Mail", "Pristine"),
		]);
		// Alvvays (2 positives) outranks Snail Mail (1).
		expect(profile.lovedArtists).toEqual(["Alvvays", "Snail Mail"]);
		expect(profile.dislikedArtists).toEqual([]);
		expect(profile.dislikedTracks).toEqual([]);
	});

	it("captures dislikes as artist + exact-track exclusions", () => {
		const profile = deriveTasteProfile([
			ev("9", "dislike", "Imagine Dragons", "Believer"),
		]);
		expect(profile.dislikedArtists).toEqual(["Imagine Dragons"]);
		expect(profile.dislikedTracks).toEqual(["Believer — Imagine Dragons"]);
		expect(profile.lovedArtists).toEqual([]);
	});

	it("uses only the latest signal per song", () => {
		// User liked a track, then changed their mind and disliked it.
		const profile = deriveTasteProfile([
			ev("5", "like", "Phoebe Bridgers", "Kyoto"),
			ev("5", "dislike", "Phoebe Bridgers", "Kyoto"),
		]);
		expect(profile.lovedArtists).toEqual([]);
		expect(profile.dislikedArtists).toEqual(["Phoebe Bridgers"]);
		expect(profile.dislikedTracks).toEqual(["Kyoto — Phoebe Bridgers"]);
	});

	it("never excludes an artist the user also likes", () => {
		const profile = deriveTasteProfile([
			ev("1", "like", "Radiohead", "Reckoner"),
			ev("2", "dislike", "Radiohead", "Pop Is Dead"),
		]);
		// The artist is loved, so not in dislikedArtists, but the specific
		// disliked track is still a hard exclusion.
		expect(profile.lovedArtists).toEqual(["Radiohead"]);
		expect(profile.dislikedArtists).toEqual([]);
		expect(profile.dislikedTracks).toEqual(["Pop Is Dead — Radiohead"]);
	});

	it("tolerates missing artist/title without crashing", () => {
		const profile = deriveTasteProfile([
			ev("1", "like", null, null),
			ev("2", "dislike", "Known Artist", null),
		]);
		expect(profile.lovedArtists).toEqual([]);
		expect(profile.dislikedArtists).toEqual(["Known Artist"]);
		// No title → can't form a "Title — Artist" exclusion.
		expect(profile.dislikedTracks).toEqual([]);
	});

	it("orders disliked tracks most-recent-first and caps the lists", () => {
		const events: FeedbackEvent[] = [];
		for (let i = 0; i < 30; i++) {
			events.push(ev(`d${i}`, "dislike", `Artist ${i}`, `Track ${i}`));
		}
		const profile = deriveTasteProfile(events);
		expect(profile.dislikedTracks.length).toBeLessThanOrEqual(20);
		// Most recent dislike (Track 29) comes first.
		expect(profile.dislikedTracks[0]).toBe("Track 29 — Artist 29");
		expect(profile.dislikedArtists.length).toBeLessThanOrEqual(15);
	});
});
