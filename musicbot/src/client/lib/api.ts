// Cookie-authed fetch wrapper. The session cookie is HttpOnly + same-origin,
// so credentials ride along automatically — we only need to handle 401s.
async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
	const res = await fetch(path, init);
	if (res.status === 401) {
		window.location.href = "/login";
		throw new Error("unauthenticated");
	}
	return res;
}

export async function getLibraryCount(): Promise<number> {
	const res = await apiFetch("/api/library/count");
	if (!res.ok) throw new Error(`library/count failed: ${res.status}`);
	const json = (await res.json()) as { count: number };
	return json.count;
}

export async function syncLibrary(): Promise<number> {
	const res = await apiFetch("/api/library/sync", { method: "POST" });
	if (!res.ok) throw new Error(`library/sync failed: ${res.status}`);
	const json = (await res.json()) as { synced: number };
	return json.synced;
}

export type ChatRecommendation = {
	id: string;
	title: string;
	artist: string;
	album?: string;
	albumArtUrl?: string;
};

export type ChatResponse = {
	reply: string;
	recommendations: ChatRecommendation[];
};

// Thrown when the user hasn't saved a BYOK key yet — the chat surfaces this as
// a prompt to open Settings rather than a generic error.
export class NoApiKeyError extends Error {
	constructor() {
		super("no_api_key");
		this.name = "NoApiKeyError";
	}
}

export async function sendChat(prompt: string): Promise<ChatResponse> {
	const res = await apiFetch("/api/chat", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ prompt }),
	});
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as { error?: string };
		if (body.error === "no_api_key") throw new NoApiKeyError();
		throw new Error(`chat failed: ${body.error ?? res.status}`);
	}
	return (await res.json()) as ChatResponse;
}

export type SettingsStatus = { hasKey: boolean; tidalConnected: boolean };

export async function getSettings(): Promise<SettingsStatus> {
	const res = await apiFetch("/api/settings");
	if (!res.ok) throw new Error(`settings failed: ${res.status}`);
	return (await res.json()) as SettingsStatus;
}

export async function saveApiKey(key: string): Promise<void> {
	const res = await apiFetch("/api/settings", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ key }),
	});
	if (!res.ok) throw new Error(`save key failed: ${res.status}`);
}

export type FeedbackKind = "like" | "dislike" | "add";

// title/artist let the taste profile name what was liked/disliked — recs aren't
// in the synced library, so the song id alone carries no meaning server-side.
export async function sendFeedback(
	songId: string,
	kind: FeedbackKind,
	title?: string,
	artist?: string,
): Promise<void> {
	const res = await apiFetch("/api/feedback", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ songId, kind, title, artist }),
	});
	if (!res.ok) throw new Error(`feedback failed: ${res.status}`);
}

// "Listen on TIDAL" deep link. Used as the no-subscription playback fallback
// (Player.tsx) and reused by Phase 5's library rows.
export function tidalTrackUrl(songId: string): string {
	return `https://listen.tidal.com/track/${encodeURIComponent(songId)}`;
}

// --- In-app playback (Phase 3.5) ------------------------------------------

export type TidalToken = {
	accessToken: string;
	expiresAt: number;
	clientId: string;
	userId: string | null;
};

// A fresh TIDAL access token for the browser Player SDK. Minted + refreshed
// server-side; the client never holds the OAuth secret.
//
// Uses a plain fetch, NOT apiFetch: this is a background call the SDK makes on
// its own schedule (incl. on pages where the user isn't signed in yet). Routing
// it through apiFetch's 401→/login redirect caused an infinite reload loop,
// since the player provider mounts on every page. On 401 we just throw and let
// the provider fall back; we never navigate.
export async function getTidalToken(): Promise<TidalToken> {
	const res = await fetch("/api/playback/token");
	if (!res.ok) throw new Error(`tidal token failed: ${res.status}`);
	return (await res.json()) as TidalToken;
}

export type ListenKind = "play_complete" | "skip" | "repeat";

// Fire-and-forget capture of in-app listen signal for the taste profile.
export async function sendListenEvent(event: {
	songId: string;
	kind: ListenKind;
	title?: string;
	artist?: string;
	msPlayed?: number;
}): Promise<void> {
	// Plain fetch (not apiFetch): fire-and-forget signal must never redirect.
	const res = await fetch("/api/playback/listen", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(event),
	});
	if (!res.ok) throw new Error(`listen event failed: ${res.status}`);
}
