import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE_NAME = "mb_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export type SessionVariables = {
	userId: string;
	sessionId: string;
};

export async function createSession(
	db: D1Database,
	userId: string,
): Promise<{ id: string; expiresAt: number }> {
	const id = crypto.randomUUID();
	const now = Math.floor(Date.now() / 1000);
	const expiresAt = now + SESSION_TTL_SECONDS;
	await db
		.prepare(
			"INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
		)
		.bind(id, userId, now, expiresAt)
		.run();
	return { id, expiresAt };
}

export function setSessionCookie(
	c: Context,
	id: string,
	expiresAt: number,
): void {
	const isProd = new URL(c.req.url).protocol === "https:";
	setCookie(c, SESSION_COOKIE_NAME, id, {
		httpOnly: true,
		secure: isProd,
		sameSite: "Lax",
		path: "/",
		expires: new Date(expiresAt * 1000),
	});
}

export function requireSession<E extends { Bindings: Env; Variables: SessionVariables }>(): MiddlewareHandler<E> {
	return async (c, next) => {
		const sid = getCookie(c, SESSION_COOKIE_NAME);
		if (!sid) return c.json({ error: "unauthenticated" }, 401);

		const row = await c.env.DB.prepare(
			"SELECT user_id, expires_at FROM sessions WHERE id = ?",
		)
			.bind(sid)
			.first<{ user_id: string; expires_at: number }>();

		if (!row) return c.json({ error: "unauthenticated" }, 401);
		if (row.expires_at <= Math.floor(Date.now() / 1000)) {
			return c.json({ error: "session_expired" }, 401);
		}

		c.set("userId", row.user_id);
		c.set("sessionId", sid);
		await next();
	};
}
