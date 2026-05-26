import { describe, expect, it } from "vitest";
import {
	MAX_SUMMARY_CHARS,
	buildRecommendationPrompt,
	summarizeLibrary,
} from "../src/lib/promptTemplates";

describe("summarizeLibrary", () => {
	it("stays under the char budget for a huge, diverse library", () => {
		const songs = Array.from({ length: 5000 }, (_, i) => ({
			title: `Song ${i}`,
			// Long artist names so the top-40 list would overflow without the cap.
			artist: `Artist With A Fairly Long Name Number ${i}`,
		}));
		const summary = summarizeLibrary(songs);
		expect(summary.length).toBeLessThanOrEqual(MAX_SUMMARY_CHARS);
		expect(summary).toContain("5000 songs");
	});

	it("surfaces the most-collected artist first, with its count", () => {
		const songs = [
			...Array.from({ length: 10 }, () => ({
				title: "x",
				artist: "Top Artist",
			})),
			...Array.from({ length: 2 }, () => ({
				title: "y",
				artist: "Rare Artist",
			})),
		];
		const summary = summarizeLibrary(songs);
		expect(summary).toContain("Top Artist (10)");
		expect(summary.indexOf("Top Artist")).toBeLessThan(
			summary.indexOf("Rare Artist"),
		);
	});
});

describe("buildRecommendationPrompt", () => {
	it("carries the count, library summary, and user request", () => {
		const { system, user } = buildRecommendationPrompt({
			librarySummary: "SUMMARY_MARKER",
			userPrompt: "something like Phoebe Bridgers but more upbeat",
			count: 5,
		});
		expect(system).toContain("5");
		expect(user).toContain("SUMMARY_MARKER");
		expect(user).toContain("more upbeat");
	});

	it("injects loved/disliked taste signals when a profile has signal", () => {
		const { system, user } = buildRecommendationPrompt({
			librarySummary: "SUMMARY",
			userPrompt: "more like this",
			count: 5,
			tasteProfile: {
				lovedArtists: ["Alvvays", "Snail Mail"],
				dislikedArtists: ["Imagine Dragons"],
				dislikedTracks: ["Believer — Imagine Dragons"],
			},
		});
		expect(user).toContain("Alvvays");
		expect(user).toContain("Snail Mail");
		expect(user).toContain("Imagine Dragons");
		expect(user).toContain("Believer — Imagine Dragons");
		// System tells the LLM to honor exclusions and be adventurous.
		expect(system).toContain("adventurous");
		expect(system).toContain("Never recommend");
	});

	it("omits the taste block (and stays cold-start identical) for an empty profile", () => {
		const base = buildRecommendationPrompt({
			librarySummary: "SUMMARY",
			userPrompt: "anything",
			count: 5,
		});
		const empty = buildRecommendationPrompt({
			librarySummary: "SUMMARY",
			userPrompt: "anything",
			count: 5,
			tasteProfile: {
				lovedArtists: [],
				dislikedArtists: [],
				dislikedTracks: [],
			},
		});
		expect(empty).toEqual(base);
		expect(empty.user).not.toContain("Taste profile");
		expect(empty.system).not.toContain("adventurous");
	});
});
