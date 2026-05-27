import {
	CheckIcon,
	HandThumbDownIcon,
	HandThumbUpIcon,
	PlayIcon,
	PlusIcon,
} from "@heroicons/react/24/outline";
import {
	HandThumbDownIcon as HandThumbDownSolidIcon,
	HandThumbUpIcon as HandThumbUpSolidIcon,
} from "@heroicons/react/24/solid";
import { useState } from "react";
import type { FeedbackKind } from "../lib/api";

export type Recommendation = {
	id: string;
	title: string;
	artist: string;
	album?: string;
	albumArtUrl?: string;
};

type Props = {
	rec: Recommendation;
	onAction?: (kind: FeedbackKind, rec: Recommendation) => void | Promise<void>;
	// Enqueue + play this rec via the app's player (Phase 3.5). The deep-link
	// fallback for non-streamable accounts lives in the player bar, not here.
	onPlay?: (rec: Recommendation) => void;
};

// 44px tap target floor (DESIGN §5, §7). `transition` + motion-safe scale gives
// the tactile press feedback (DESIGN §1) while honoring prefers-reduced-motion.
const buttonBase =
	"flex h-11 w-11 items-center justify-center rounded-xl border border-stone-700 bg-stone-800 text-stone-100 transition hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900 motion-safe:active:scale-95 disabled:opacity-40 disabled:hover:bg-stone-800";

// Filled state for like/dislike/added — a class change the tests can assert.
// The icon also swaps outline→solid (or +→✓) so color is never the only signal.
const activeButton = "border-teal-500 text-teal-400";

export function RecommendationCard({ rec, onAction, onPlay }: Props) {
	// Only real TIDAL tracks are actionable. Their ids are numeric strings;
	// placeholders ("p1") and catalog misses ("llm:0") aren't, so there's
	// nothing to play, add, or meaningfully rate — disable the actions.
	const resolved = /^\d+$/.test(rec.id);
	const [feedback, setFeedback] = useState<"like" | "dislike" | null>(null);
	const [added, setAdded] = useState(false);

	// like/dislike are mutually exclusive; clicking the active one clears it. We
	// POST only on activation (no "unlike" event) — the append-only log lets
	// Phase 4 take the latest signal per song.
	function toggle(kind: "like" | "dislike") {
		const next = feedback === kind ? null : kind;
		setFeedback(next);
		if (next) void onAction?.(kind, rec);
	}

	function add() {
		if (added) return;
		setAdded(true); // optimistic; revert if the server rejects the add
		Promise.resolve(onAction?.("add", rec)).catch(() => setAdded(false));
	}

	const liked = feedback === "like";
	const disliked = feedback === "dislike";

	return (
		<article
			aria-label={`${rec.title} by ${rec.artist}`}
			className="flex items-center gap-4 rounded-xl border border-stone-700 bg-stone-800 p-4"
		>
			<div
				className="h-16 w-16 flex-none overflow-hidden rounded-xl bg-stone-700"
				aria-hidden="true"
			>
				{rec.albumArtUrl ? (
					<img
						src={rec.albumArtUrl}
						alt=""
						className="h-full w-full object-cover"
					/>
				) : null}
			</div>
			<div className="min-w-0 flex-1">
				<h3 className="font-display truncate text-lg text-stone-100">
					{rec.title}
				</h3>
				<p className="truncate text-sm text-stone-400">{rec.artist}</p>
			</div>
			<div className="flex flex-none gap-2">
				<button
					type="button"
					aria-label="Play"
					disabled={!resolved}
					onClick={() => onPlay?.(rec)}
					className={buttonBase}
				>
					<PlayIcon className="h-5 w-5" aria-hidden="true" />
				</button>
				<button
					type="button"
					aria-label={added ? "Added to library" : "Add to library"}
					disabled={!resolved}
					onClick={add}
					className={`${buttonBase}${added ? ` ${activeButton}` : ""}`}
				>
					{added ? (
						<CheckIcon className="h-5 w-5" aria-hidden="true" />
					) : (
						<PlusIcon className="h-5 w-5" aria-hidden="true" />
					)}
				</button>
				<button
					type="button"
					aria-label="Like"
					aria-pressed={liked}
					disabled={!resolved}
					onClick={() => toggle("like")}
					className={`${buttonBase}${liked ? ` ${activeButton}` : ""}`}
				>
					{liked ? (
						<HandThumbUpSolidIcon className="h-5 w-5" aria-hidden="true" />
					) : (
						<HandThumbUpIcon className="h-5 w-5" aria-hidden="true" />
					)}
				</button>
				<button
					type="button"
					aria-label="Dislike"
					aria-pressed={disliked}
					disabled={!resolved}
					onClick={() => toggle("dislike")}
					className={`${buttonBase}${disliked ? ` ${activeButton}` : ""}`}
				>
					{disliked ? (
						<HandThumbDownSolidIcon className="h-5 w-5" aria-hidden="true" />
					) : (
						<HandThumbDownIcon className="h-5 w-5" aria-hidden="true" />
					)}
				</button>
			</div>
		</article>
	);
}
