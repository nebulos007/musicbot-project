import { Hono } from "hono";
import { createSession, setSessionCookie } from "../lib/session";
import {
	TIDAL_AUTHORIZE_URL,
	TIDAL_SCOPES,
	exchangeCode,
	fetchMe,
	generatePkce,
	generateState,
	pkceKvKey,
	tokensKvKey,
} from "../lib/tidal";

const PKCE_TTL_SECONDS = 600;

export const authRouter = new Hono<{ Bindings: Env }>();

function callbackUrl(reqUrl: string): string {
	return `${new URL(reqUrl).origin}/api/auth/callback`;
}

authRouter.get("/login", async (c) => {
	const { verifier, challenge } = await generatePkce();
	const state = generateState();
	await c.env.SESSIONS.put(
		pkceKvKey(state),
		JSON.stringify({ verifier, createdAt: Math.floor(Date.now() / 1000) }),
		{ expirationTtl: PKCE_TTL_SECONDS },
	);

	const authorize = new URL(TIDAL_AUTHORIZE_URL);
	authorize.searchParams.set("response_type", "code");
	authorize.searchParams.set("client_id", c.env.TIDAL_CLIENT_ID);
	authorize.searchParams.set("redirect_uri", callbackUrl(c.req.url));
	authorize.searchParams.set("scope", TIDAL_SCOPES);
	authorize.searchParams.set("state", state);
	authorize.searchParams.set("code_challenge", challenge);
	authorize.searchParams.set("code_challenge_method", "S256");

	return c.redirect(authorize.toString(), 302);
});

authRouter.get("/callback", async (c) => {
	const code = c.req.query("code");
	const state = c.req.query("state");
	if (!code || !state) return c.json({ error: "missing_params" }, 400);

	const stored = (await c.env.SESSIONS.get(pkceKvKey(state), "json")) as
		| { verifier: string }
		| null;
	if (!stored) return c.json({ error: "invalid_state" }, 400);
	await c.env.SESSIONS.delete(pkceKvKey(state));

	const tokens = await exchangeCode({
		code,
		codeVerifier: stored.verifier,
		redirectUri: callbackUrl(c.req.url),
		clientId: c.env.TIDAL_CLIENT_ID,
		clientSecret: c.env.TIDAL_CLIENT_SECRET,
	});

	const me = await fetchMe(tokens.accessToken);

	const now = Math.floor(Date.now() / 1000);
	const existing = await c.env.DB.prepare(
		"SELECT id FROM users WHERE tidal_user_id = ?",
	)
		.bind(me.id)
		.first<{ id: string }>();
	const userId = existing?.id ?? crypto.randomUUID();
	if (!existing) {
		await c.env.DB.prepare(
			"INSERT INTO users (id, tidal_user_id, created_at) VALUES (?, ?, ?)",
		)
			.bind(userId, me.id, now)
			.run();
	}

	await c.env.SESSIONS.put(tokensKvKey(userId), JSON.stringify(tokens));

	const { id: sessionId, expiresAt } = await createSession(c.env.DB, userId);
	setSessionCookie(c, sessionId, expiresAt);

	return c.redirect("/", 302);
});
