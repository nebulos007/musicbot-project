import { Tab, TabGroup, TabList, TabPanel, TabPanels } from "@headlessui/react";
import {
	ArrowPathIcon,
	Cog6ToothIcon,
	PaperAirplaneIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import {
	RecommendationCard,
	type Recommendation,
} from "../components/RecommendationCard";
import {
	NoApiKeyError,
	getLibraryCount,
	sendChat,
	sendFeedback,
	syncLibrary,
} from "../lib/api";
import { usePlayer } from "../lib/player";
import { Link } from "../lib/router";

// Shown before the first prompt so the screen isn't empty; replaced by real
// recs on the first reply.
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

type Message = {
	role: "user" | "assistant";
	text: string;
	action?: "settings";
};

function tabClass({ selected }: { selected: boolean }) {
	const base =
		"px-4 py-2 text-sm font-medium rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900";
	return selected
		? `${base} bg-stone-800 text-stone-100`
		: `${base} text-stone-400 hover:text-stone-100`;
}

export function Chat() {
	const [lib, setLib] = useState<LibraryState>({ status: "loading" });
	const [messages, setMessages] = useState<Message[]>([]);
	const [recs, setRecs] = useState<Recommendation[]>(PLACEHOLDER_RECS);
	const [pending, setPending] = useState(false);
	const { playQueue } = usePlayer();

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

	// Manual re-sync: libraries change, and the mount effect only auto-syncs an
	// empty library. The endpoint upserts, so re-running is safe; `synced` is the
	// full library count.
	async function handleSync() {
		setLib({ status: "syncing" });
		try {
			setLib({ status: "ready", count: await syncLibrary() });
		} catch (e) {
			setLib({
				status: "error",
				message: e instanceof Error ? e.message : "unknown error",
			});
		}
	}

	async function handleSend(prompt: string) {
		setMessages((m) => [...m, { role: "user", text: prompt }]);
		setPending(true);
		try {
			const res = await sendChat(prompt);
			setMessages((m) => [...m, { role: "assistant", text: res.reply }]);
			setRecs(res.recommendations);
		} catch (e) {
			const msg: Message =
				e instanceof NoApiKeyError
					? {
							role: "assistant",
							text: "Add your Google AI Studio key in Settings to get recommendations.",
							action: "settings",
						}
					: {
							role: "assistant",
							text: `Something went wrong: ${
								e instanceof Error ? e.message : "unknown error"
							}`,
						};
			setMessages((m) => [...m, msg]);
		} finally {
			setPending(false);
		}
	}

	// pb-28 keeps the chat input clear of the fixed player bar (DESIGN §6).
	return (
		<div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col px-6 pt-6 pb-28">
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
						<div className="flex items-center justify-between gap-2">
							<LibraryStatus lib={lib} />
							<button
								type="button"
								onClick={handleSync}
								disabled={lib.status === "loading" || lib.status === "syncing"}
								aria-label="Sync library"
								className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-stone-400 hover:bg-stone-800 hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900 disabled:opacity-50"
							>
								<ArrowPathIcon
									// motion-safe so the spin respects prefers-reduced-motion (DESIGN §5).
									className={`h-5 w-5 ${lib.status === "syncing" ? "motion-safe:animate-spin" : ""}`}
									aria-hidden="true"
								/>
							</button>
						</div>
						<MessageThread messages={messages} pending={pending} />
						<ul className="mt-4 space-y-3">
							{recs.map((rec) => (
								<li key={rec.id}>
									<RecommendationCard
										rec={rec}
										onAction={(kind, r) =>
											sendFeedback(r.id, kind, r.title, r.artist)
										}
										onPlay={(r) => playQueue(recs, recs.indexOf(r))}
									/>
								</li>
							))}
						</ul>
						<ChatInput onSend={handleSend} disabled={pending} />
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

function MessageThread({
	messages,
	pending,
}: {
	messages: Message[];
	pending: boolean;
}) {
	if (messages.length === 0 && !pending) return null;
	return (
		// aria-live so assistant replies are announced as they land (DESIGN §5).
		<div className="mt-4 space-y-3" aria-live="polite">
			{messages.map((m, i) => (
				<div
					// Order is append-only; index is a stable key here.
					key={i}
					className={m.role === "user" ? "flex justify-end" : "flex justify-start"}
				>
					<div
						className={
							m.role === "user"
								? "max-w-[80%] rounded-2xl bg-teal-500 px-4 py-2 text-stone-900"
								: "max-w-[80%] rounded-2xl bg-stone-800 px-4 py-2 text-stone-100"
						}
					>
						{m.text}
						{m.action === "settings" ? (
							<>
								{" "}
								<Link
									to="/settings"
									className="font-medium text-teal-400 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-800"
								>
									Open Settings
								</Link>
							</>
						) : null}
					</div>
				</div>
			))}
			{pending ? (
				<div className="flex justify-start">
					<div className="rounded-2xl bg-stone-800 px-4 py-2 text-stone-400">
						Thinking…
					</div>
				</div>
			) : null}
		</div>
	);
}

function ChatInput({
	onSend,
	disabled,
}: {
	onSend: (prompt: string) => void;
	disabled: boolean;
}) {
	const [value, setValue] = useState("");
	return (
		<form
			className="mt-6 flex items-center gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				const trimmed = value.trim();
				if (!trimmed || disabled) return;
				setValue("");
				onSend(trimmed);
			}}
		>
			<label htmlFor="chat-input" className="sr-only">
				What do you want to hear?
			</label>
			<input
				id="chat-input"
				type="text"
				value={value}
				onChange={(e) => setValue(e.target.value)}
				placeholder="What do you want to hear?"
				className="h-11 flex-1 rounded-xl border border-stone-700 bg-stone-800 px-4 text-stone-100 placeholder:text-stone-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900"
			/>
			<button
				type="submit"
				aria-label="Send"
				disabled={disabled}
				className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-500 text-stone-900 transition-colors hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900 disabled:opacity-50"
			>
				<PaperAirplaneIcon className="h-5 w-5" aria-hidden="true" />
			</button>
		</form>
	);
}
