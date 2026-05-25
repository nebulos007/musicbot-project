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
});
