import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RecommendationCard, type Recommendation } from "./RecommendationCard";

const rec: Recommendation = {
	id: "test-1",
	title: "Test Title",
	artist: "Test Artist",
	albumArtUrl: "https://example.com/art.jpg",
};

// A resolved rec — a numeric TIDAL track id makes the actions live.
const realRec: Recommendation = {
	id: "12345",
	title: "Real Title",
	artist: "Real Artist",
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

describe("RecommendationCard actions", () => {
	it("Play deep-links to the track on TIDAL", () => {
		render(<RecommendationCard rec={realRec} />);
		const play = screen.getByRole("link", { name: "Play" });
		expect(play).toHaveAttribute(
			"href",
			"https://listen.tidal.com/track/12345",
		);
		expect(play).toHaveAttribute("target", "_blank");
	});

	it("Like toggles pressed + fill state and posts only on activation", () => {
		const onAction = vi.fn();
		render(<RecommendationCard rec={realRec} onAction={onAction} />);
		const like = screen.getByRole("button", { name: "Like" });

		expect(like).toHaveAttribute("aria-pressed", "false");

		fireEvent.click(like);
		expect(onAction).toHaveBeenCalledWith("like", realRec);
		expect(like).toHaveAttribute("aria-pressed", "true");
		expect(like.className).toContain("text-teal-400"); // fill, not color alone

		// Clicking again clears it without posting an "unlike".
		fireEvent.click(like);
		expect(like).toHaveAttribute("aria-pressed", "false");
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("Like and Dislike are mutually exclusive", () => {
		const onAction = vi.fn();
		render(<RecommendationCard rec={realRec} onAction={onAction} />);

		fireEvent.click(screen.getByRole("button", { name: "Like" }));
		fireEvent.click(screen.getByRole("button", { name: "Dislike" }));

		expect(screen.getByRole("button", { name: "Like" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
		expect(screen.getByRole("button", { name: "Dislike" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		expect(onAction).toHaveBeenNthCalledWith(1, "like", realRec);
		expect(onAction).toHaveBeenNthCalledWith(2, "dislike", realRec);
	});

	it("Add flips to the added state and posts once", () => {
		const onAction = vi.fn().mockResolvedValue(undefined);
		render(<RecommendationCard rec={realRec} onAction={onAction} />);

		fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
		expect(onAction).toHaveBeenCalledWith("add", realRec);

		const added = screen.getByRole("button", { name: "Added to library" });
		expect(added.className).toContain("text-teal-400");

		fireEvent.click(added);
		expect(onAction).toHaveBeenCalledTimes(1);
	});

	it("reverts the added state when the server rejects the add", async () => {
		const onAction = vi.fn().mockRejectedValue(new Error("nope"));
		render(<RecommendationCard rec={realRec} onAction={onAction} />);

		fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
		// After the rejected promise settles, the label reverts.
		expect(
			await screen.findByRole("button", { name: "Add to library" }),
		).toBeInTheDocument();
	});

	it("disables every action for an unresolved (non-track) rec", () => {
		render(
			<RecommendationCard rec={{ id: "llm:0", title: "T", artist: "A" }} />,
		);
		expect(screen.queryByRole("link", { name: "Play" })).toBeNull();
		expect(screen.getByRole("button", { name: "Play" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Add to library" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Like" })).toBeDisabled();
		expect(screen.getByRole("button", { name: "Dislike" })).toBeDisabled();
	});

	it("every control meets the 44px (h-11 w-11) tap-target floor", () => {
		render(<RecommendationCard rec={realRec} />);
		const controls = [
			screen.getByRole("link", { name: "Play" }),
			screen.getByRole("button", { name: "Add to library" }),
			screen.getByRole("button", { name: "Like" }),
			screen.getByRole("button", { name: "Dislike" }),
		];
		for (const el of controls) {
			expect(el.className).toContain("h-11");
			expect(el.className).toContain("w-11");
		}
	});
});
