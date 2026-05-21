import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("worker routing", () => {
	it("GET /api/health returns ok", async () => {
		const res = await SELF.fetch("http://example.com/api/health");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});
});
