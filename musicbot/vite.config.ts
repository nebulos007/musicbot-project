import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Vite builds the SPA into ./public. The same Worker (see wrangler.jsonc) serves
// these assets at / and /api/* routes from src/index.ts. `publicDir: false`
// disables Vite's "copy public/ as static assets" behavior — we use public/ as
// the build output, not as a static-asset source.
export default defineConfig({
	plugins: [react(), tailwindcss()],
	build: {
		outDir: "public",
		emptyOutDir: true,
		rollupOptions: {
			output: {
				manualChunks(id) {
					// Keep Vite's shared __vite_preload helper in its own tiny chunk so
					// the app entry imports only that (not the SDK) statically. Otherwise
					// Rollup folds the helper into an SDK chunk and `index` ends up
					// statically importing the SDK, running its top-level init at startup
					// (throws on Safari → blank page) instead of behind PlayerProvider's
					// lazy, try/caught boundary.
					if (id.includes("preload-helper")) return "vite-preload";
					// Mirror the TIDAL Player SDK's own dist layout: one chunk per SDK
					// module. The SDK ships pre-split ESM with a circular graph (load →
					// dynamic import of browser/shaka/native engines → basePlayer → back
					// to load) plus top-level await. That only resolves at the SDK's own
					// granularity. If Rollup MERGES its modules we break one of two ways:
					// a single merged chunk reorders top-level-await initializers ("AS is
					// not a function" at module-eval), while coarser default chunking
					// facades the dynamically-imported engine and drops its `default`
					// ("undefined is not a constructor" / `new x`). One-chunk-per-module
					// preserves both the dynamic-import boundaries (real `default`) and
					// each module's original statement order.
					const m = id.match(
						/[/\\]@tidal-music[/\\]player[/\\].*[/\\]([^/\\]+)\.js$/,
					);
					if (m) return `tidal-${m[1]}`;
				},
			},
		},
	},
	publicDir: false,
});
