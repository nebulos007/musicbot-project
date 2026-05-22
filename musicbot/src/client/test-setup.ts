import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// @testing-library/react auto-cleans only when it detects a global afterEach.
// We keep `globals: false` in vitest.client.config.mts, so wire it up by hand.
afterEach(() => {
	cleanup();
});
