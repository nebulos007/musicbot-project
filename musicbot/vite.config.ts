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
	},
	publicDir: false,
});
