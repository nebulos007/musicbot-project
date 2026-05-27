import { type TidalToken, getTidalToken } from "./api";

// The TIDAL Player SDK calls getCredentials() whenever it needs a token. We do
// NOT run OAuth in the browser — the token is minted and refreshed server-side
// (confidential client) and handed over via /api/playback/token. This thin
// provider matches @tidal-music/common's CredentialsProvider shape ({ bus,
// getCredentials }) and caches the token until shortly before it expires so the
// SDK doesn't hit our Worker on every call.

// The app (client-credentials) token has no scopes; mirror that so the SDK
// doesn't expect user scopes it won't find on the token.
const SCOPES: string[] = [];
const EXPIRY_LEEWAY_MS = 30_000;

// Mirrors @tidal-music/common's Credentials (the fields the player consumes).
export type Credentials = {
	clientId: string;
	requestedScopes: string[];
	token?: string;
	userId?: string;
	expires?: number;
};

export type CredentialsProvider = {
	bus: (cb: (event: unknown) => void) => void;
	getCredentials: () => Promise<Credentials>;
};

export function createCredentialsProvider(
	fetchToken: () => Promise<TidalToken> = getTidalToken,
): CredentialsProvider {
	let cached: Credentials | null = null;
	let cachedExpiresMs = 0;

	return {
		// The SDK subscribes here for credential-change events. The server owns
		// refresh, so we never push — a no-op sink is enough.
		bus: () => {},
		async getCredentials() {
			if (cached && Date.now() < cachedExpiresMs - EXPIRY_LEEWAY_MS) {
				return cached;
			}
			const t = await fetchToken();
			cachedExpiresMs = t.expiresAt * 1000;
			cached = {
				clientId: t.clientId,
				requestedScopes: SCOPES,
				token: t.accessToken,
				userId: t.userId ?? undefined,
				expires: cachedExpiresMs,
			};
			return cached;
		},
	};
}
