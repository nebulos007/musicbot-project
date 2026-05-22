export const TIDAL_AUTHORIZE_URL = "https://login.tidal.com/authorize";
export const TIDAL_TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token";
export const TIDAL_ME_URL = "https://openapi.tidal.com/v2/users/me";
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
