export const TIDAL_AUTHORIZE_URL = "https://login.tidal.com/authorize";
export const TIDAL_TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token";
export const TIDAL_ME_URL = "https://openapi.tidal.com/v2/users/me";
export const TIDAL_API_BASE = "https://openapi.tidal.com/v2";
export const TIDAL_SCOPES = "user.read collection.read collection.write";

const REFRESH_LEEWAY_SECONDS = 60;

export type TidalTokens = {
	accessToken: string;
	refreshToken: string;
	expiresAt: number;
	scope: string;
	tokenType: string;
};

export const tokensKvKey = (userId: string) => `tidal_tokens:${userId}`;
export const pkceKvKey = (state: string) => `pkce:${state}`;
export const byokKvKey = (userId: string) => `byok_key:${userId}`;
// App-level (client-credentials) token, shared across users. Used only for the
// Player SDK's 30s-preview playback — full-track streaming isn't available to
// third-party web apps (see clientCredentialsToken).
export const APP_TOKEN_KV_KEY = "tidal_app_token";

function base64UrlEncode(bytes: Uint8Array): string {
	let s = "";
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePkce(): Promise<{
	verifier: string;
	challenge: string;
}> {
	const bytes = new Uint8Array(32);
	crypto.getRandomValues(bytes);
	const verifier = base64UrlEncode(bytes);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(verifier),
	);
	return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)) };
}

export function generateState(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	return base64UrlEncode(bytes);
}

type TokenResponse = {
	access_token: string;
	refresh_token?: string;
	expires_in: number;
	scope: string;
	token_type: string;
};

function tokensFromResponse(
	json: TokenResponse,
	fallbackRefresh?: string,
): TidalTokens {
	const refresh = json.refresh_token ?? fallbackRefresh;
	if (!refresh) throw new Error("TIDAL token response missing refresh_token");
	return {
		accessToken: json.access_token,
		refreshToken: refresh,
		expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
		scope: json.scope,
		tokenType: json.token_type,
	};
}

export async function exchangeCode(params: {
	code: string;
	codeVerifier: string;
	redirectUri: string;
	clientId: string;
	clientSecret: string;
}): Promise<TidalTokens> {
	const body = new URLSearchParams({
		grant_type: "authorization_code",
		code: params.code,
		redirect_uri: params.redirectUri,
		client_id: params.clientId,
		client_secret: params.clientSecret,
		code_verifier: params.codeVerifier,
	});
	const res = await fetch(TIDAL_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) {
		throw new Error(
			`TIDAL token exchange failed: ${res.status} ${await res.text()}`,
		);
	}
	return tokensFromResponse(await res.json());
}

export async function refreshTokens(params: {
	refreshToken: string;
	clientId: string;
	clientSecret: string;
}): Promise<TidalTokens> {
	const body = new URLSearchParams({
		grant_type: "refresh_token",
		refresh_token: params.refreshToken,
		client_id: params.clientId,
		client_secret: params.clientSecret,
	});
	const res = await fetch(TIDAL_TOKEN_URL, {
		method: "POST",
		headers: { "content-type": "application/x-www-form-urlencoded" },
		body,
	});
	if (!res.ok) {
		throw new Error(
			`TIDAL token refresh failed: ${res.status} ${await res.text()}`,
		);
	}
	return tokensFromResponse(await res.json(), params.refreshToken);
}

export async function fetchMe(accessToken: string): Promise<{ id: string }> {
	const res = await fetch(TIDAL_ME_URL, {
		headers: { authorization: `Bearer ${accessToken}` },
	});
	if (!res.ok) {
		throw new Error(
			`TIDAL /users/me failed: ${res.status} ${await res.text()}`,
		);
	}
	const json = (await res.json()) as
		| { data: { id: string } }
		| { id: string };
	if ("data" in json && json.data && typeof json.data.id === "string") {
		return { id: json.data.id };
	}
	if ("id" in json && typeof json.id === "string") return { id: json.id };
	throw new Error("Unexpected /users/me response shape");
}

export async function refreshIfNeeded(
	env: Env,
	userId: string,
): Promise<string> {
	const stored = (await env.SESSIONS.get(
		tokensKvKey(userId),
		"json",
	)) as TidalTokens | null;
	if (!stored) throw new Error(`No tokens stored for user ${userId}`);
	if (stored.expiresAt - REFRESH_LEEWAY_SECONDS > Math.floor(Date.now() / 1000)) {
		return stored.accessToken;
	}
	const fresh = await refreshTokens({
		refreshToken: stored.refreshToken,
		clientId: env.TIDAL_CLIENT_ID,
		clientSecret: env.TIDAL_CLIENT_SECRET,
	});
	await env.SESSIONS.put(tokensKvKey(userId), JSON.stringify(fresh));
	return fresh.accessToken;
}

// --- App token (client credentials) ----------------------------------------
// Mints an app-authenticated token via the OAuth client_credentials grant,
// cached in KV (~4h, the token's own lifetime). This is what the browser Player
// SDK uses: TIDAL only serves 30-second previews to a third-party app token
// (full-track streaming requires r_usr+playback scopes that aren't grantable to
// web apps — verified 2026-05-26), and previews don't depend on the user's
// subscription. The client secret never leaves the Worker.

export type AppToken = { accessToken: string; expiresAt: number };

const APP_TOKEN_LEEWAY_SECONDS = 120;

export async function clientCredentialsToken(env: Env): Promise<AppToken> {
	const cached = (await env.SESSIONS.get(
		APP_TOKEN_KV_KEY,
		"json",
	)) as AppToken | null;
	if (
		cached &&
		cached.expiresAt - APP_TOKEN_LEEWAY_SECONDS > Math.floor(Date.now() / 1000)
	) {
		return cached;
	}
	const basic = btoa(`${env.TIDAL_CLIENT_ID}:${env.TIDAL_CLIENT_SECRET}`);
	const res = await fetch(TIDAL_TOKEN_URL, {
		method: "POST",
		headers: {
			authorization: `Basic ${basic}`,
			"content-type": "application/x-www-form-urlencoded",
		},
		body: new URLSearchParams({ grant_type: "client_credentials" }),
	});
	if (!res.ok) {
		throw new Error(
			`TIDAL client_credentials failed: ${res.status} ${await res.text()}`,
		);
	}
	const json = (await res.json()) as {
		access_token: string;
		expires_in: number;
	};
	const token: AppToken = {
		accessToken: json.access_token,
		expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
	};
	await env.SESSIONS.put(APP_TOKEN_KV_KEY, JSON.stringify(token), {
		expirationTtl: json.expires_in,
	});
	return token;
}

// --- Library sync ---------------------------------------------------------

export type LibrarySong = {
	songId: string;
	title: string;
	artist: string;
	addedAt: number;
};

type RawIncluded = {
	type: string;
	id: string;
	attributes?: Record<string, unknown>;
	relationships?: Record<string, { data?: Array<{ type: string; id: string }> }>;
};

type RawLibraryPage = {
	data?: Array<{
		id: string;
		type: string;
		meta?: { addedAt?: string };
	}>;
	included?: RawIncluded[];
	links?: { next?: string };
};

export type LibraryPage = {
	songs: LibrarySong[];
	nextPath: string | null;
};

// TIDAL's collection-items cursor pages over a single sort key and re-emits /
// skips tracks at tie-clusters of equal keys (e.g. many tracks added in the same
// second under -addedAt). A track skipped under one sort is near-certainly not at
// a tie boundary under an unrelated sort, so the union across these orthogonal
// sorts recovers the whole collection. On the free Workers plan two full passes
// exceed the 50-subrequest cap, so /sync runs ONE sort per request and the client
// loops over the passes — hence this list is exported for the route to index.
export const LIBRARY_SORTS = ["-addedAt", "title", "artists.name"] as const;

function libraryItemsPath(sort: string): string {
	return (
		"/userCollectionTracks/me/relationships/items" +
		"?include=items,items.artists&countryCode=US&locale=en-US" +
		`&sort=${encodeURIComponent(sort)}`
	);
}

const MAX_RETRIES = 3;
const DEFAULT_BACKOFF_SECONDS = 1;

export type FetchLibraryOpts = {
	accessToken: string;
	sleep?: (seconds: number) => Promise<void>;
	now?: () => number;
};

function defaultSleep(seconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
}

function indexIncluded(
	included: RawIncluded[] | undefined,
): Map<string, RawIncluded> {
	const m = new Map<string, RawIncluded>();
	for (const r of included ?? []) m.set(`${r.type}:${r.id}`, r);
	return m;
}

function isoToEpochSeconds(iso: string | undefined, fallback: number): number {
	if (!iso) return fallback;
	const t = Date.parse(iso);
	return Number.isNaN(t) ? fallback : Math.floor(t / 1000);
}

function parsePage(json: RawLibraryPage, nowSeconds: number): LibraryPage {
	const included = indexIncluded(json.included);
	const songs: LibrarySong[] = [];
	for (const item of json.data ?? []) {
		const track = included.get(`tracks:${item.id}`);
		if (!track) continue;
		const title =
			typeof track.attributes?.title === "string"
				? (track.attributes.title as string)
				: null;
		if (!title) continue;
		const artistRel = track.relationships?.artists?.data ?? [];
		const firstArtistId = artistRel[0]?.id;
		const artist = firstArtistId
			? ((included.get(`artists:${firstArtistId}`)?.attributes?.name as
					| string
					| undefined) ?? "Unknown Artist")
			: "Unknown Artist";
		songs.push({
			songId: item.id,
			title,
			artist,
			addedAt: isoToEpochSeconds(item.meta?.addedAt, nowSeconds),
		});
	}
	return { songs, nextPath: json.links?.next ?? null };
}

function parseRetryAfter(header: string | null): number {
	if (!header) return DEFAULT_BACKOFF_SECONDS;
	const n = Number(header);
	if (Number.isFinite(n) && n >= 0) return n;
	const epochMs = Date.parse(header);
	if (Number.isNaN(epochMs)) return DEFAULT_BACKOFF_SECONDS;
	const delta = Math.ceil((epochMs - Date.now()) / 1000);
	return Math.max(delta, 0);
}

export async function fetchLibraryPage(
	path: string,
	opts: FetchLibraryOpts,
): Promise<LibraryPage> {
	const url = path.startsWith("http") ? path : `${TIDAL_API_BASE}${path}`;
	const sleep = opts.sleep ?? defaultSleep;
	const now = opts.now ?? (() => Math.floor(Date.now() / 1000));
	let attempt = 0;
	for (;;) {
		const res = await fetch(url, {
			headers: {
				authorization: `Bearer ${opts.accessToken}`,
				accept: "application/vnd.api+json",
			},
		});
		if (res.status === 429 && attempt < MAX_RETRIES) {
			const wait = parseRetryAfter(res.headers.get("retry-after"));
			await sleep(wait);
			attempt++;
			continue;
		}
		if (!res.ok) {
			throw new Error(
				`TIDAL library fetch failed: ${res.status} ${await res.text()}`,
			);
		}
		const json = (await res.json()) as RawLibraryPage;
		return parsePage(json, now());
	}
}

// TIDAL's authoritative collection size, read from the parent resource. Used as
// the completeness target for the multi-sort union and to gate mirror deletes.
// Returns null on any error so callers degrade to a single-pass, no-delete sync.
export async function fetchCollectionSize(
	opts: FetchLibraryOpts,
): Promise<number | null> {
	const sleep = opts.sleep ?? defaultSleep;
	const url = `${TIDAL_API_BASE}/userCollectionTracks/me?countryCode=US&locale=en-US`;
	try {
		for (let attempt = 0; ; attempt++) {
			const res = await fetch(url, {
				headers: {
					authorization: `Bearer ${opts.accessToken}`,
					accept: "application/vnd.api+json",
				},
			});
			if (res.status === 429 && attempt < MAX_RETRIES) {
				await sleep(parseRetryAfter(res.headers.get("retry-after")));
				continue;
			}
			if (!res.ok) return null;
			const j = (await res.json()) as {
				data?: { attributes?: { numberOfItems?: number } };
			};
			return j.data?.attributes?.numberOfItems ?? null;
		}
	} catch {
		return null;
	}
}

// Paginate one sort order to exhaustion. Callers union successive sorts (across
// requests, on free tier) to recover tracks any single sort's cursor skips.
export async function fetchLibrarySort(
	sort: string,
	opts: FetchLibraryOpts,
): Promise<LibrarySong[]> {
	const songs: LibrarySong[] = [];
	let path: string | null = libraryItemsPath(sort);
	while (path) {
		const page: LibraryPage = await fetchLibraryPage(path, opts);
		songs.push(...page.songs);
		path = page.nextPath;
	}
	return songs;
}

// --- Catalog search --------------------------------------------------------
// Resolves the LLM's free-text "title artist" guess to a real TIDAL track so a
// recommendation card has a canonical title/artist, album art, and a track id
// (the id Phase 3 needs to play/add). Phase 5 reuses this for album-art
// backfill of the synced library.

export type CatalogTrack = {
	tidalId: string;
	title: string;
	artist: string;
	album: string | null;
	albumArtUrl: string | null;
};

// The cover-art chain is track → albums → coverArt(artworks) → files[].href, so
// we pull all three relationships in one call. countryCode is required by the API.
const SEARCH_INCLUDE = "tracks,tracks.albums,tracks.albums.coverArt,tracks.artists";
// Cover art comes in several sizes; pick the smallest that's still crisp on a card.
const MIN_COVER_WIDTH = 320;

type RawArtworkFile = { href?: string; meta?: { width?: number } };

// A JSON:API relationship's `data` is an array for to-many and a bare object
// for to-one (e.g. an album's single coverArt). Handle both.
function relFirstId(rel: { data?: unknown } | undefined): string | undefined {
	const data = rel?.data;
	if (Array.isArray(data)) return (data[0] as { id?: string } | undefined)?.id;
	if (data && typeof data === "object") return (data as { id?: string }).id;
	return undefined;
}

function pickArtwork(files: RawArtworkFile[] | undefined): string | null {
	const withHref = (files ?? []).filter(
		(f): f is RawArtworkFile & { href: string } => typeof f.href === "string",
	);
	if (withHref.length === 0) return null;
	const bySize = [...withHref].sort(
		(a, b) => (a.meta?.width ?? 0) - (b.meta?.width ?? 0),
	);
	const mid = bySize.find((f) => (f.meta?.width ?? 0) >= MIN_COVER_WIDTH);
	return (mid ?? bySize[bySize.length - 1]).href;
}

export async function searchTrack(
	query: string,
	accessToken: string,
	countryCode = "US",
): Promise<CatalogTrack | null> {
	const url =
		`${TIDAL_API_BASE}/searchResults/${encodeURIComponent(query)}` +
		`?countryCode=${countryCode}&include=${encodeURIComponent(SEARCH_INCLUDE)}`;

	let res: Response;
	try {
		res = await fetch(url, {
			headers: {
				authorization: `Bearer ${accessToken}`,
				accept: "application/vnd.api+json",
			},
		});
	} catch {
		return null; // network blip — degrade to no-art rather than fail the chat
	}
	if (!res.ok) return null;

	const json = (await res.json()) as {
		data?: { relationships?: { tracks?: { data?: Array<{ id: string }> } } };
		included?: RawIncluded[];
	};

	const firstTrackId = json.data?.relationships?.tracks?.data?.[0]?.id;
	if (!firstTrackId) return null;

	const included = indexIncluded(json.included);
	const track = included.get(`tracks:${firstTrackId}`);
	const title =
		typeof track?.attributes?.title === "string"
			? (track.attributes.title as string)
			: null;
	if (!track || !title) return null;

	const artistId = relFirstId(track.relationships?.artists);
	const artist = artistId
		? ((included.get(`artists:${artistId}`)?.attributes?.name as
				| string
				| undefined) ?? "Unknown Artist")
		: "Unknown Artist";

	const albumId = relFirstId(track.relationships?.albums);
	const album = albumId ? included.get(`albums:${albumId}`) : undefined;
	const albumTitle =
		typeof album?.attributes?.title === "string"
			? (album.attributes.title as string)
			: null;

	const coverArtId = relFirstId(album?.relationships?.coverArt);
	const cover = coverArtId ? included.get(`artworks:${coverArtId}`) : undefined;
	const albumArtUrl = pickArtwork(
		cover?.attributes?.files as RawArtworkFile[] | undefined,
	);

	return { tidalId: firstTrackId, title, artist, album: albumTitle, albumArtUrl };
}

// --- Library writes --------------------------------------------------------
// Add a catalog track to the authenticated user's TIDAL collection. Verified
// against the live tidal-api-oas.json (2026-05-26): POST to the to-many items
// relationship with a JSON:API resource-identifier array. `me` resolves to the
// authenticated user (same literal Phase 1c uses for the GET).

export type AddToLibraryOpts = {
	accessToken: string;
	sleep?: (seconds: number) => Promise<void>;
};

export async function addToLibrary(
	trackId: string,
	opts: AddToLibraryOpts,
	countryCode = "US",
): Promise<void> {
	const url =
		`${TIDAL_API_BASE}/userCollectionTracks/me/relationships/items` +
		`?countryCode=${countryCode}`;
	const body = JSON.stringify({ data: [{ type: "tracks", id: trackId }] });
	const sleep = opts.sleep ?? defaultSleep;
	let attempt = 0;
	for (;;) {
		const res = await fetch(url, {
			method: "POST",
			headers: {
				authorization: `Bearer ${opts.accessToken}`,
				"content-type": "application/vnd.api+json",
				accept: "application/vnd.api+json",
			},
			body,
		});
		if (res.status === 429 && attempt < MAX_RETRIES) {
			await sleep(parseRetryAfter(res.headers.get("retry-after")));
			attempt++;
			continue;
		}
		// 409 = already in the collection; adding is idempotent, so treat as done.
		if (!res.ok && res.status !== 409) {
			throw new Error(
				`TIDAL add-to-library failed: ${res.status} ${await res.text()}`,
			);
		}
		return;
	}
}
