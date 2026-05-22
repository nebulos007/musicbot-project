import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
	plugins: [react()],
	test: {
		name: "client",
		environment: "happy-dom",
		include: ["src/client/**/*.spec.{ts,tsx}"],
		setupFiles: ["./src/client/test-setup.ts"],
		globals: false,
	},
});
