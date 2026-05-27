import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Chat } from "./Chat";

function jsonResponse(body: unknown) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { "content-type": "application/json" },
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Chat", () => {
	it("submits a prompt to /api/chat and renders the returned recommendations", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/api/library/count")) {
				return jsonResponse({ count: 42 });
			}
			if (url.endsWith("/api/chat")) {
				return jsonResponse({
					reply: "Here you go.",
					recommendations: [
						{ id: "t1", title: "Real Song", artist: "Real Artist" },
					],
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<Chat />);

		// Library count resolves on mount → input is ready.
		const input = await screen.findByLabelText("What do you want to hear?");
		fireEvent.change(input, { target: { value: "upbeat indie" } });
		fireEvent.submit(input.closest("form") as HTMLFormElement);

		// Real rec replaces the placeholders; user + assistant bubbles appear.
		expect(await screen.findByText("Real Song")).toBeInTheDocument();
		expect(screen.getByText("Here you go.")).toBeInTheDocument();
		expect(screen.getByText("upbeat indie")).toBeInTheDocument();
		expect(screen.queryByText("Track title")).not.toBeInTheDocument();

		expect(fetchMock).toHaveBeenCalledWith(
			"/api/chat",
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("re-syncs the library and updates the count when the sync button is clicked", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/api/library/count")) {
				return jsonResponse({ count: 10 });
			}
			if (url.includes("/api/library/sync") && init?.method === "POST") {
				return jsonResponse({
					synced: 13,
					complete: true,
					syncId: 1,
					nextPass: null,
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<Chat />);
		expect(
			await screen.findByText("Loaded 10 songs from your library"),
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole("button", { name: "Sync library" }));

		expect(
			await screen.findByText("Loaded 13 songs from your library"),
		).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining("/api/library/sync"),
			expect.objectContaining({ method: "POST" }),
		);
	});

	it("prompts the user to open Settings when no API key is set", async () => {
		const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input.toString();
			if (url.endsWith("/api/library/count")) {
				return jsonResponse({ count: 5 });
			}
			if (url.endsWith("/api/chat")) {
				return new Response(JSON.stringify({ error: "no_api_key" }), {
					status: 400,
					headers: { "content-type": "application/json" },
				});
			}
			throw new Error(`unexpected fetch: ${url}`);
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<Chat />);
		const input = await screen.findByLabelText("What do you want to hear?");
		fireEvent.change(input, { target: { value: "anything" } });
		fireEvent.submit(input.closest("form") as HTMLFormElement);

		expect(
			await screen.findByText(/Add your Google AI Studio key/i),
		).toBeInTheDocument();
		expect(
			screen.getByRole("link", { name: "Open Settings" }),
		).toBeInTheDocument();
	});
});
