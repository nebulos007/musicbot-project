import { describe, expect, it, vi } from "vitest";
import type { Recommendation } from "../components/RecommendationCard";
import {
	type EngineEvent,
	type PlaybackStatus,
	type PlayerEngine,
	createPlayerStore,
} from "./player";

function makeEngine() {
	let handler: ((e: EngineEvent) => void) | null = null;
	let position = 0;
	let duration = 0;
	let status: PlaybackStatus = "IDLE";
	const calls = {
		load: [] as string[],
		setNext: [] as (string | null)[],
		play: 0,
		pause: 0,
		seek: [] as number[],
	};
	const doPlay = () => {
		calls.play++;
		status = "PLAYING";
	};
	const engine: PlayerEngine = {
		// Mirror the real adapter: autoplay plays once load "resolves".
		load: (p, autoplay) => {
			calls.load.push(p.productId);
			if (autoplay) doPlay();
		},
		setNext: (p) => calls.setNext.push(p?.productId ?? null),
		play: doPlay,
		pause: () => {
			calls.pause++;
			status = "NOT_PLAYING";
		},
		seek: (s) => calls.seek.push(s),
		getAssetPosition: () => position,
		getDuration: () => duration,
		getPlaybackState: () => status,
		on: (h) => {
			handler = h;
			return () => {
				handler = null;
			};
		},
	};
	return {
		engine,
		calls,
		emit: (e: EngineEvent) => handler?.(e),
		setPosition: (s: number) => {
			position = s;
		},
		setDuration: (s: number) => {
			duration = s;
		},
		lastSetNext: () => calls.setNext[calls.setNext.length - 1],
	};
}

const recs: Recommendation[] = [
	{ id: "1", title: "One", artist: "A" },
	{ id: "2", title: "Two", artist: "B" },
	{ id: "3", title: "Three", artist: "C" },
];

describe("player store", () => {
	it("playQueue loads the first track, plays, and queues the next", () => {
		const f = makeEngine();
		const store = createPlayerStore(f.engine, { reportListen: vi.fn() });

		store.playQueue(recs, 0);

		expect(f.calls.load).toEqual(["1"]);
		expect(f.calls.setNext).toEqual(["2"]);
		expect(f.calls.play).toBe(1);
		expect(store.getState().current?.id).toBe("1");
	});

	it("next advances and prev retreats, loading each", () => {
		const f = makeEngine();
		const store = createPlayerStore(f.engine, { reportListen: vi.fn() });

		store.playQueue(recs, 0);
		f.emit({ type: "media-product-transition", productId: "1" }); // load echo

		store.next();
		expect(store.getState().current?.id).toBe("2");

		store.prev(); // position 0 → step back rather than restart
		expect(store.getState().current?.id).toBe("1");
		expect(f.calls.load).toEqual(["1", "2", "1"]);
	});

	it("reflects the SDK playback state and toggles play/pause", () => {
		const f = makeEngine();
		const store = createPlayerStore(f.engine, { reportListen: vi.fn() });

		store.playQueue(recs, 0);
		f.emit({ type: "playback-state-change" });
		expect(store.getState().status).toBe("PLAYING");

		store.togglePlay();
		expect(f.calls.pause).toBe(1);
	});

	it("classifies a natural transition as a full play", () => {
		const reportListen = vi.fn();
		const f = makeEngine();
		const store = createPlayerStore(f.engine, { reportListen });

		store.playQueue(recs, 0);
		f.emit({ type: "media-product-transition", productId: "1" }); // load echo
		f.setPosition(200);
		f.setDuration(205);
		store.tick();
		// The queued "next" (track 2) starts on its own.
		f.emit({ type: "media-product-transition", productId: "2" });

		expect(reportListen).toHaveBeenCalledWith(
			expect.objectContaining({ songId: "1", kind: "play_complete" }),
		);
		expect(store.getState().current?.id).toBe("2");
	});

	it("classifies an early manual skip as a skip", () => {
		const reportListen = vi.fn();
		const f = makeEngine();
		const store = createPlayerStore(f.engine, { reportListen });

		store.playQueue(recs, 0);
		f.emit({ type: "media-product-transition", productId: "1" });
		f.setPosition(3);
		f.setDuration(200);
		store.tick();
		store.next();

		expect(reportListen).toHaveBeenCalledWith(
			expect.objectContaining({ songId: "1", kind: "skip" }),
		);
	});

	it("repeat loops the current track and records a repeat", () => {
		const reportListen = vi.fn();
		const f = makeEngine();
		const store = createPlayerStore(f.engine, { reportListen });

		store.playQueue(recs, 0);
		f.emit({ type: "media-product-transition", productId: "1" });

		store.toggleRepeat();
		expect(store.getState().repeat).toBe(true);
		expect(f.lastSetNext()).toBe("1"); // queues itself, not track 2

		f.emit({ type: "media-product-transition", productId: "1" }); // looped
		expect(reportListen).toHaveBeenCalledWith(
			expect.objectContaining({ songId: "1", kind: "repeat" }),
		);
	});

	it("marks playback unavailable on an engine error (deep-link fallback)", () => {
		const f = makeEngine();
		const store = createPlayerStore(f.engine, { reportListen: vi.fn() });

		store.playQueue(recs, 0);
		expect(store.getState().available).toBe(true);

		f.emit({ type: "error" });
		expect(store.getState().available).toBe(false);
	});

	it("shuffle reorders the tail and keeps the current track at the head", () => {
		const four: Recommendation[] = [
			...recs,
			{ id: "4", title: "Four", artist: "D" },
		];
		const f = makeEngine();
		const store = createPlayerStore(f.engine, {
			reportListen: vi.fn(),
			random: () => 0, // deterministic Fisher–Yates
		});

		store.playQueue(four, 0);
		store.toggleShuffle();

		expect(store.getState().shuffle).toBe(true);
		expect(store.getState().queue.map((r) => r.id)).toEqual(["1", "3", "4", "2"]);
		expect(f.lastSetNext()).toBe("3"); // next reflects the reshuffled tail
	});
});
