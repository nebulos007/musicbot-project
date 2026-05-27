import {
	type ReactNode,
	createContext,
	createElement,
	useContext,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { Recommendation } from "../components/RecommendationCard";
import {
	type ListenKind,
	sendListenEvent,
	tidalTrackUrl,
} from "./api";
import { createCredentialsProvider } from "./credentials";

// The TIDAL Player SDK uses a "load + setNext" model — one active product plus
// one queued "next", no native queue. So this store owns the recommendation
// queue and drives load / setNext / advance itself. The real SDK is wrapped
// behind PlayerEngine (in tidalEngine.ts, dynamically imported by the provider)
// so unit tests run against a fake engine and never load the SDK (it can't run
// in happy-dom).

export type PlaybackStatus = "IDLE" | "NOT_PLAYING" | "PLAYING" | "STALLED";

export type MediaProduct = {
	productId: string;
	productType: "track";
	sourceType: string;
	sourceId: string;
};

export type EngineEvent =
	| { type: "playback-state-change" }
	| { type: "media-product-transition"; productId: string | null }
	| { type: "error"; message?: string };

export interface PlayerEngine {
	// `load` is async in the SDK; `autoplay` must start playback only *after* it
	// resolves and a player is active (calling play() too early throws
	// "No active player"). The adapter sequences that internally.
	load(product: MediaProduct, autoplay?: boolean): void;
	setNext(product: MediaProduct | null): void;
	play(): void;
	pause(): void;
	seek(seconds: number): void;
	getAssetPosition(): number; // seconds
	getDuration(): number; // seconds
	getPlaybackState(): PlaybackStatus;
	on(handler: (event: EngineEvent) => void): () => void;
}

export type PlayerState = {
	current: Recommendation | null;
	queue: Recommendation[];
	index: number;
	status: PlaybackStatus;
	positionMs: number;
	durationMs: number;
	repeat: boolean;
	shuffle: boolean;
	available: boolean;
	// Last playback error message, shown in the player bar so a failed load/play
	// is visible rather than silent. Cleared when playback next starts.
	lastError: string | null;
};

export type PlayerActions = {
	playQueue(recs: Recommendation[], startIndex?: number): void;
	togglePlay(): void;
	next(): void;
	prev(): void;
	seek(seconds: number): void;
	toggleRepeat(): void;
	toggleShuffle(): void;
};

export type PlayerStore = PlayerActions & {
	getState(): PlayerState;
	subscribe(listener: () => void): () => void;
	tick(): void;
	setAvailable(value: boolean): void;
	destroy(): void;
};

const SOURCE = { sourceType: "MUSICBOT", sourceId: "recommendations" };
// A track left at ≥90% played counts as a full play rather than a skip.
const COMPLETION_RATIO = 0.9;
// prev() within this many ms restarts the track instead of going back one.
const RESTART_THRESHOLD_MS = 3000;

const IDLE_STATE: PlayerState = {
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

function productFor(rec: Recommendation): MediaProduct {
	return { productId: rec.id, productType: "track", ...SOURCE };
}

function shuffleArray<T>(arr: T[], random: () => number): T[] {
	const a = [...arr];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

type ListenReport = {
	songId: string;
	kind: ListenKind;
	title?: string;
	artist?: string;
	msPlayed?: number;
};

type Deps = {
	reportListen?: (event: ListenReport) => void;
	random?: () => number;
};

export function createPlayerStore(
	engine: PlayerEngine,
	deps: Deps = {},
): PlayerStore {
	const reportListen =
		deps.reportListen ?? ((e) => void sendListenEvent(e).catch(() => {}));
	const random = deps.random ?? Math.random;

	let state: PlayerState = { ...IDLE_STATE };
	const listeners = new Set<() => void>();
	// The SDK fires a transition for our own load() calls too; remember the id
	// we just loaded so we don't misread that echo as a natural advance/loop.
	let ignoreTransitionFor: string | null = null;

	function emit() {
		for (const l of listeners) l();
	}
	function set(patch: Partial<PlayerState>) {
		state = { ...state, ...patch };
		emit();
	}

	function report(rec: Recommendation, kind: ListenKind) {
		reportListen({
			songId: rec.id,
			kind,
			title: rec.title,
			artist: rec.artist,
			msPlayed: state.positionMs,
		});
	}

	// How much of the current track was heard when the user leaves it.
	function leaveKind(): ListenKind {
		return state.durationMs > 0 &&
			state.positionMs >= state.durationMs * COMPLETION_RATIO
			? "play_complete"
			: "skip";
	}

	function nextRec(): Recommendation | null {
		// Repeat is repeat-one: the SDK loops the current track on its own.
		if (state.repeat) return state.current;
		return state.queue[state.index + 1] ?? null;
	}

	function updateNext() {
		const n = nextRec();
		engine.setNext(n ? productFor(n) : null);
	}

	function loadIndex(i: number, autoplay: boolean) {
		const rec = state.queue[i];
		if (!rec) return;
		ignoreTransitionFor = rec.id;
		// Autoplay is sequenced inside the engine (play() after load() resolves).
		engine.load(productFor(rec), autoplay);
		set({ index: i, current: rec, positionMs: 0, durationMs: 0, lastError: null });
		updateNext();
	}

	function playQueue(recs: Recommendation[], startIndex = 0) {
		if (state.current && state.status === "PLAYING") {
			report(state.current, leaveKind());
		}
		state = { ...state, queue: recs, index: startIndex };
		loadIndex(startIndex, true);
	}

	function togglePlay() {
		if (!state.current) return;
		if (state.status === "PLAYING") engine.pause();
		else engine.play();
	}

	function next() {
		const i = state.index + 1;
		if (i >= state.queue.length) return; // end of queue
		if (state.current) report(state.current, leaveKind());
		loadIndex(i, true);
	}

	function prev() {
		if (state.positionMs > RESTART_THRESHOLD_MS) {
			engine.seek(0);
			set({ positionMs: 0 });
			return;
		}
		loadIndex(Math.max(0, state.index - 1), true);
	}

	function seek(seconds: number) {
		engine.seek(seconds);
		set({ positionMs: Math.round(seconds * 1000) });
	}

	function toggleRepeat() {
		set({ repeat: !state.repeat });
		updateNext();
	}

	function toggleShuffle() {
		const shuffle = !state.shuffle;
		if (shuffle && state.index >= 0) {
			// Keep what's played/playing; shuffle only what's still ahead.
			const head = state.queue.slice(0, state.index + 1);
			const tail = shuffleArray(state.queue.slice(state.index + 1), random);
			set({ shuffle, queue: [...head, ...tail] });
			updateNext();
		} else {
			set({ shuffle });
		}
	}

	const unsubscribe = engine.on((event) => {
		if (event.type === "playback-state-change") {
			const status = engine.getPlaybackState();
			// Clear a stale error once audio actually starts.
			set({ status, lastError: status === "PLAYING" ? null : state.lastError });
			return;
		}
		// Playback errored (commonly: account can't stream this track). Surface
		// the reason and offer the deep-link fallback in the bar.
		if (event.type === "error") {
			set({ available: false, lastError: event.message ?? "playback error" });
			return;
		}
		const pid = event.productId;
		if (pid === null) {
			set({ status: "IDLE" });
			return;
		}
		if (ignoreTransitionFor === pid) {
			ignoreTransitionFor = null; // the echo of our own load()
			return;
		}
		// Repeat-one looped back to the same track.
		if (state.repeat && state.current && pid === state.current.id) {
			report(state.current, "repeat");
			set({ positionMs: 0 });
			updateNext();
			return;
		}
		// The queued "next" started on its own → the current track finished.
		const upcoming = state.queue[state.index + 1];
		if (upcoming && pid === upcoming.id) {
			if (state.current) report(state.current, "play_complete");
			set({
				index: state.index + 1,
				current: upcoming,
				positionMs: 0,
				durationMs: 0,
			});
			updateNext();
			return;
		}
		// Defensive: reconcile to whatever the SDK says is playing.
		const found = state.queue.findIndex((r) => r.id === pid);
		if (found >= 0) set({ index: found, current: state.queue[found] });
	});

	function tick() {
		set({
			positionMs: Math.round(engine.getAssetPosition() * 1000),
			durationMs: Math.round(engine.getDuration() * 1000),
		});
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		tick,
		setAvailable: (value) => set({ available: value }),
		destroy: unsubscribe,
		playQueue,
		togglePlay,
		next,
		prev,
		seek,
		toggleRepeat,
		toggleShuffle,
	};
}

// --- React wiring ----------------------------------------------------------

const NOOP_ACTIONS: PlayerActions = {
	playQueue: () => {},
	togglePlay: () => {},
	next: () => {},
	prev: () => {},
	seek: () => {},
	toggleRepeat: () => {},
	toggleShuffle: () => {},
};

// Default store for components rendered without a provider (e.g. unit tests):
// pure no-op, marked unavailable.
const noopState: PlayerState = { ...IDLE_STATE, available: false };
const noopPlayerStore: PlayerStore = {
	getState: () => noopState,
	subscribe: () => () => {},
	tick: () => {},
	setAvailable: () => {},
	destroy: () => {},
	...NOOP_ACTIONS,
};

// Fallback when the SDK can't init or the account can't stream: Play still
// works by deep-linking to TIDAL (no dead button — preserves Phase 3 behavior).
function createFallbackStore(): PlayerStore {
	return {
		...noopPlayerStore,
		playQueue(recs, startIndex = 0) {
			const rec = recs[startIndex];
			if (rec) window.open(tidalTrackUrl(rec.id), "_blank", "noopener");
		},
	};
}

export const PlayerContext = createContext<PlayerStore>(noopPlayerStore);

export function PlayerProvider({ children }: { children: ReactNode }) {
	const [store, setStore] = useState<PlayerStore>(noopPlayerStore);
	const storeRef = useRef<PlayerStore>(store);
	storeRef.current = store;

	useEffect(() => {
		let active = store;
		let cancelled = false;
		(async () => {
			try {
				// Dynamic import keeps the SDK out of the bundle until the app runs
				// (and out of unit tests entirely).
				const { createTidalEngine } = await import("./tidalEngine");
				const engine = await createTidalEngine(createCredentialsProvider());
				if (cancelled) return;
				active = createPlayerStore(engine);
				setStore(active);
			} catch {
				// SDK failed to load/init → deep-link fallback (Play opens TIDAL).
				if (!cancelled) setStore(createFallbackStore());
			}
		})();
		return () => {
			cancelled = true;
			active.destroy();
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Drive the scrubber: poll the engine while audio is playing.
	useEffect(() => {
		const id = window.setInterval(() => {
			if (storeRef.current.getState().status === "PLAYING") {
				storeRef.current.tick();
			}
		}, 500);
		return () => window.clearInterval(id);
	}, []);

	return createElement(PlayerContext.Provider, { value: store }, children);
}

export function usePlayer(): PlayerState & PlayerActions {
	const store = useContext(PlayerContext);
	const state = useSyncExternalStore(
		store.subscribe,
		store.getState,
		store.getState,
	);
	return {
		...state,
		playQueue: store.playQueue,
		togglePlay: store.togglePlay,
		next: store.next,
		prev: store.prev,
		seek: store.seek,
		toggleRepeat: store.toggleRepeat,
		toggleShuffle: store.toggleShuffle,
	};
}
