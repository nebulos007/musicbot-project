import { Hono } from "hono";
import { type SessionVariables, requireSession } from "../lib/session";
import { byokKvKey, tokensKvKey } from "../lib/tidal";

export const settingsRouter = new Hono<{
	Bindings: Env;
	Variables: SessionVariables;
}>();

settingsRouter.use("*", requireSession());

// Status only — never returns the stored key. From the client's view the BYOK
// key is write-only; reading it back would expose a secret to any XSS.
settingsRouter.get("/", async (c) => {
	const userId = c.get("userId");
	const [key, tokens] = await Promise.all([
		c.env.SESSIONS.get(byokKvKey(userId)),
		c.env.SESSIONS.get(tokensKvKey(userId)),
	]);
	return c.json({ hasKey: key !== null, tidalConnected: tokens !== null });
});

settingsRouter.post("/", async (c) => {
	const userId = c.get("userId");
	const body = await c.req
		.json<{ key?: string }>()
		.catch(() => ({}) as { key?: string });
	const key = typeof body.key === "string" ? body.key.trim() : "";
	if (!key) return c.json({ error: "missing_key" }, 400);
	await c.env.SESSIONS.put(byokKvKey(userId), key);
	return c.json({ hasKey: true });
});
