import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
	PlayerContext,
	type PlayerState,
	type PlayerStore,
} from "../lib/player";
import { type Recommendation } from "./RecommendationCard";
import { Player } from "./Player";

const track: Recommendation = { id: "42", title: "One", artist: "A" };

const baseState: PlayerState = {
	current: null,
	queue: [],
	index: -1,
	status: "IDLE",
	positionMs: 0,
	durationMs: 0,
	repeat: false,
	shuffle: false,
	available: true,
	lastError: null,
};

function renderPlayer(state: Partial<PlayerState>) {
	const snapshot: PlayerState = { ...baseState, ...state };
	const store: PlayerStore = {
		getState: () => snapshot, // stable reference for useSyncExternalStore
		subscribe: () => () => {},
		tick: () => {},
		setAvailable: () => {},
		destroy: () => {},
		playQueue: vi.fn(),
		togglePlay: vi.fn(),
		next: vi.fn(),
		prev: vi.fn(),
		seek: vi.fn(),
		toggleRepeat: vi.fn(),
		toggleShuffle: vi.fn(),
	};
	const result = render(
		<PlayerContext.Provider value={store}>
			<Player />
		</PlayerContext.Provider>,
	);
	return { store, ...result };
}

describe("Player", () => {
	it("renders nothing when no track is loaded", () => {
		renderPlayer({ current: null });
		expect(screen.queryByRole("region", { name: "Player" })).toBeNull();
	});

	it("shows now-playing info and transport controls when a track is loaded", () => {
		renderPlayer({ current: track, status: "NOT_PLAYING" });
		expect(screen.getByText("One")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "Previous" })).toBeInTheDocument();
	});

	it("shows Pause and toggles playback when playing", () => {
		const { store } = renderPlayer({ current: track, status: "PLAYING" });
		const pause = screen.getByRole("button", { name: "Pause" });
		fireEvent.click(pause);
		expect(store.togglePlay).toHaveBeenCalled();
	});

	it("exposes an accessible scrubber", () => {
		renderPlayer({ current: track, positionMs: 50000, durationMs: 200000 });
		expect(screen.getByLabelText("Seek")).toBeInTheDocument();
	});

	it("reflects repeat/shuffle pressed state and toggles them", () => {
		const { store } = renderPlayer({
			current: track,
			repeat: true,
			shuffle: false,
		});
		expect(screen.getByRole("button", { name: "Repeat" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		fireEvent.click(screen.getByRole("button", { name: "Shuffle" }));
		expect(store.toggleShuffle).toHaveBeenCalled();
	});

	it("offers a full-track TIDAL link while previewing", () => {
		renderPlayer({ current: track, status: "PLAYING" });
		const link = screen.getByRole("link", { name: /Full track on TIDAL/ });
		expect(link).toHaveAttribute(
			"href",
			"https://listen.tidal.com/track/42",
		);
		// transport is still present (we're previewing in-app, not falling back)
		expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
	});

	it("falls back to a Listen on TIDAL link when playback is unavailable", () => {
		renderPlayer({ current: track, available: false });
		const link = screen.getByRole("link", { name: "Listen on TIDAL" });
		expect(link).toHaveAttribute(
			"href",
			"https://listen.tidal.com/track/42",
		);
		expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
	});
});
