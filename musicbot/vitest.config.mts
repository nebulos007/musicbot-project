import { defineConfig } from "vitest/config";

// Two test environments live in this repo:
//   - workers: Worker code runs in the real workerd runtime via
//     @cloudflare/vitest-pool-workers (Phase 1a–1c tests).
//   - client:  React components run in happy-dom for Phase 1d+ UI tests.
// Each project owns its own config file; vitest resolves both when `npm test`
// is invoked.
export default defineConfig({
	test: {
		projects: ["./vitest.workers.config.mts", "./vitest.client.config.mts"],
	},
});
