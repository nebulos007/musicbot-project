import * as player from "@tidal-music/player";
import type { CredentialsProvider } from "./credentials";
import type {
	EngineEvent,
	MediaProduct,
	PlaybackStatus,
	PlayerEngine,
} from "./player";

// The ONLY module that imports @tidal-music/player. Loaded lazily by
// PlayerProvider (dynamic import) so the SDK never enters the unit-test bundle
// or runs in happy-dom. Everything player-store-side talks to PlayerEngine.
//
// NOTE (verify live — PRD §7 biggest risk): the init order, the `sourceType`
// value, and the exact event-name strings below come from the TIDAL web SDK
// docs but haven't been exercised against a real subscribed account yet. If the
// SDK rejects the custom credentials provider or a track is ineligible, the
// caller (PlayerProvider) catches and falls back to the deep link.

export async function createTidalEngine(
	credentialsProvider: CredentialsProvider,
): Promise<PlayerEngine> {
	// The SDK's audio-context-store does an unguarded `new AudioContext()`. WebKit
	// (older/iOS Safari) only exposes webkitAudioContext, so the SDK throws
	// "undefined is not a constructor" mid-playback on mobile. Alias it before
	// bootstrap — mirroring what the SDK's own bundled shaka build does for the
	// same call (`new (window.AudioContext||window.webkitAudioContext)`).
	if (typeof AudioContext === "undefined" && "webkitAudioContext" in window) {
		// biome-ignore lint/suspicious/noExplicitAny: webkitAudioContext is untyped.
		(window as any).AudioContext = (window as any).webkitAudioContext;
	}
	// biome-ignore lint/suspicious/noExplicitAny: SDK's CredentialsProvider type
	// is structurally what we pass; cast to avoid coupling to its internal shape.
	player.setCredentialsProvider(credentialsProvider as any);
	// The SDK refuses to play "without an event sender" (it logs play telemetry).
	// hasEventSender() is just a truthiness check and the player only calls
	// sendEvent(), so a no-op stub satisfies it — we don't need the full
	// @tidal-music/event-producer dependency or to send TIDAL any analytics.
	// biome-ignore lint/suspicious/noExplicitAny: minimal structural stub.
	player.setEventSender({ sendEvent: () => {} } as any);
	// Register the web players for track audio. browser + shaka cover TIDAL's
	// progressive and adaptive (DASH) streams; output-device selection is off.
	player.bootstrap({
		outputDevices: false,
		players: [
			{ itemTypes: ["track"], player: "browser" },
			{ itemTypes: ["track"], player: "shaka" },
		],
	});

	// Set when the store subscribes via on(); lets load/play push their failure
	// reason back to the store, which surfaces it in the player bar.
	let emit: ((event: EngineEvent) => void) | null = null;
	const fail = (where: string, e: unknown) => {
		const message = e instanceof Error ? e.message : String(e);
		emit?.({ type: "error", message: `${where}: ${message}` });
	};

	return {
		load(product: MediaProduct, autoplay = false) {
			// Start playback only after load() resolves and a player is active —
			// calling play() before that throws "No active player".
			player
				.load(product)
				.then(() => (autoplay ? player.play() : undefined))
				.catch((e) => fail("load/play", e));
		},
		setNext(product: MediaProduct | null) {
			// setNext(undefined) clears the queued next product. A failure here only
			// concerns the *preloaded next* track, so log it rather than surfacing a
			// fatal error: the current track keeps playing and the engine re-fetches
			// on the next load().
			player
				.setNext(product ?? undefined)
				.catch((e) => console.warn("setNext failed (non-fatal):", e));
		},
		play() {
			player.play().catch((e) => fail("play", e));
		},
		pause() {
			player.pause(); // returns void, not a promise
		},
		seek(seconds: number) {
			void player.seek(seconds);
		},
		getAssetPosition() {
			return player.getAssetPosition() ?? 0;
		},
		getDuration() {
			return player.getPlaybackContext()?.actualDuration ?? 0;
		},
		getPlaybackState() {
			return (player.getPlaybackState() ?? "IDLE") as PlaybackStatus;
		},
		on(handler: (event: EngineEvent) => void) {
			emit = handler;
			const onState = () => handler({ type: "playback-state-change" });
			const onTransition = () =>
				handler({
					type: "media-product-transition",
					productId: player.getMediaProduct()?.productId ?? null,
				});
			const onError = (e: Event) => {
				const detail = (e as CustomEvent).detail;
				const message =
					typeof detail === "string" ? detail : JSON.stringify(detail);
				handler({ type: "error", message: `sdk: ${message}` });
			};
			player.events.addEventListener("playback-state-change", onState);
			player.events.addEventListener("media-product-transition", onTransition);
			player.events.addEventListener("error", onError);
			return () => {
				emit = null;
				player.events.removeEventListener("playback-state-change", onState);
				player.events.removeEventListener(
					"media-product-transition",
					onTransition,
				);
				player.events.removeEventListener("error", onError);
			};
		},
	};
}
