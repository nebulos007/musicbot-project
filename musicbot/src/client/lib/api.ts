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

export async function sendFeedback(
	songId: string,
	kind: FeedbackKind,
): Promise<void> {
	const res = await apiFetch("/api/feedback", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ songId, kind }),
	});
	if (!res.ok) throw new Error(`feedback failed: ${res.status}`);
}

// "Listen on TIDAL" deep link. Interim playback for v1 until the Player SDK
// lands in its own slice; Phase 5's library rows reuse this same helper.
export function tidalTrackUrl(songId: string): string {
	return `https://listen.tidal.com/track/${encodeURIComponent(songId)}`;
}
