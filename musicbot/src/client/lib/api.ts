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
