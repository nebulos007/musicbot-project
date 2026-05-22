import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { RecommendationCard, type Recommendation } from "./RecommendationCard";

const rec: Recommendation = {
	id: "test-1",
	title: "Test Title",
	artist: "Test Artist",
	albumArtUrl: "https://example.com/art.jpg",
};

describe("RecommendationCard", () => {
	it("renders title, artist, and album art", () => {
		const { container } = render(<RecommendationCard rec={rec} />);
		expect(screen.getByText("Test Title")).toBeInTheDocument();
		expect(screen.getByText("Test Artist")).toBeInTheDocument();
		// alt="" → role=presentation (decorative); query by tag instead.
		expect(container.querySelector("img")).toHaveAttribute(
			"src",
			"https://example.com/art.jpg",
		);
	});

	it("renders the four action buttons with accessible labels", () => {
		render(<RecommendationCard rec={rec} />);
		expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
		expect(
			screen.getByRole("button", { name: "Add to library" }),
		).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Like" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Dislike" })).toBeInTheDocument();
	});

	it("exposes the card as an article labeled with title + artist", () => {
		render(<RecommendationCard rec={rec} />);
		expect(
			screen.getByRole("article", { name: "Test Title by Test Artist" }),
		).toBeInTheDocument();
	});

	it("omits the album art when no URL is provided", () => {
		const { container } = render(
			<RecommendationCard rec={{ id: "x", title: "T", artist: "A" }} />,
		);
		expect(container.querySelector("img")).toBeNull();
	});
});
