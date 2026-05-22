import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		name: "workers",
		include: ["test/**/*.spec.ts"],
		poolOptions: {
			workers: {
				wrangler: { configPath: "./wrangler.jsonc" },
			},
		},
	},
});
