import { TabGroup, TabList, Tab, TabPanels, TabPanel } from "@headlessui/react";
import { Cog6ToothIcon, PaperAirplaneIcon } from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import {
	RecommendationCard,
	type Recommendation,
} from "../components/RecommendationCard";
import { getLibraryCount, syncLibrary } from "../lib/api";
import { Link } from "../lib/router";

// Phase 1d ships placeholder cards. Phase 2 replaces these with LLM-driven recs.
const PLACEHOLDER_RECS: Recommendation[] = [
	{ id: "p1", title: "Track title", artist: "Artist name" },
	{ id: "p2", title: "Another track", artist: "Another artist" },
	{ id: "p3", title: "Third track", artist: "Third artist" },
];

type LibraryState =
	| { status: "loading" }
	| { status: "syncing" }
	| { status: "ready"; count: number }
	| { status: "error"; message: string };

function tabClass({ selected }: { selected: boolean }) {
	const base =
		"px-4 py-2 text-sm font-medium rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900";
	return selected
		? `${base} bg-stone-800 text-stone-100`
		: `${base} text-stone-400 hover:text-stone-100`;
}

export function Chat() {
	const [lib, setLib] = useState<LibraryState>({ status: "loading" });

	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const count = await getLibraryCount();
				if (cancelled) return;
				if (count > 0) {
					setLib({ status: "ready", count });
					return;
				}
				setLib({ status: "syncing" });
				const synced = await syncLibrary();
				if (cancelled) return;
				setLib({ status: "ready", count: synced });
			} catch (e) {
				if (cancelled) return;
				setLib({
					status: "error",
					message: e instanceof Error ? e.message : "unknown error",
				});
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 py-6">
			<header className="flex items-center justify-between">
				<h1 className="font-display text-2xl text-stone-100">musicbot</h1>
				<Link
					to="/settings"
					aria-label="Settings"
					className="flex h-11 w-11 items-center justify-center rounded-xl text-stone-400 hover:bg-stone-800 hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900"
				>
					<Cog6ToothIcon className="h-6 w-6" aria-hidden="true" />
				</Link>
			</header>

			<TabGroup as="div" className="mt-6 flex flex-1 flex-col">
				<TabList className="flex gap-2 border-b border-stone-700 pb-2">
					<Tab className={tabClass}>Chat</Tab>
					<Tab className={tabClass}>Library</Tab>
				</TabList>
				<TabPanels className="mt-6 flex flex-1 flex-col">
					<TabPanel className="flex flex-1 flex-col">
						<LibraryStatus lib={lib} />
						<ul className="mt-4 space-y-3">
							{PLACEHOLDER_RECS.map((rec) => (
								<li key={rec.id}>
									<RecommendationCard rec={rec} />
								</li>
							))}
						</ul>
						<ChatInput />
					</TabPanel>
					<TabPanel>
						<p className="text-stone-400">
							Past recommendations land here in Phase 5.
						</p>
					</TabPanel>
				</TabPanels>
			</TabGroup>
		</div>
	);
}

function LibraryStatus({ lib }: { lib: LibraryState }) {
	let text: string;
	switch (lib.status) {
		case "loading":
			text = "Loading library…";
			break;
		case "syncing":
			text = "Syncing your TIDAL library…";
			break;
		case "ready":
			text = `Loaded ${lib.count.toLocaleString()} songs from your library`;
			break;
		case "error":
			text = `Library unavailable: ${lib.message}`;
			break;
	}
	return (
		<p
			className="text-sm text-stone-400"
			aria-live="polite"
			aria-busy={lib.status === "loading" || lib.status === "syncing"}
		>
			{text}
		</p>
	);
}

function ChatInput() {
	return (
		<form
			className="mt-6 flex items-center gap-2"
			onSubmit={(e) => {
				// Phase 2 wires this to POST /api/chat.
				e.preventDefault();
			}}
		>
			<label htmlFor="chat-input" className="sr-only">
				What do you want to hear?
			</label>
			<input
				id="chat-input"
				type="text"
				placeholder="What do you want to hear?"
				className="h-11 flex-1 rounded-xl border border-stone-700 bg-stone-800 px-4 text-stone-100 placeholder:text-stone-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900"
			/>
			<button
				type="submit"
				aria-label="Send"
				className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500 text-stone-900 transition-colors hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900"
			>
				<PaperAirplaneIcon className="h-5 w-5" aria-hidden="true" />
			</button>
		</form>
	);
}
