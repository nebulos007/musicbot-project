import {
	PlayIcon,
	PlusIcon,
	HandThumbUpIcon,
	HandThumbDownIcon,
} from "@heroicons/react/24/outline";

export type Recommendation = {
	id: string;
	title: string;
	artist: string;
	album?: string;
	albumArtUrl?: string;
};

type Props = {
	rec: Recommendation;
};

// 44px tap target floor (DESIGN §5, §7 — phone-grade ergonomics).
const buttonBase =
	"flex h-11 w-11 items-center justify-center rounded-xl border border-stone-700 bg-stone-800 text-stone-100 transition-colors hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900";

export function RecommendationCard({ rec }: Props) {
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
				<button type="button" aria-label="Play" className={buttonBase}>
					<PlayIcon className="h-5 w-5" aria-hidden="true" />
				</button>
				<button
					type="button"
					aria-label="Add to library"
					className={buttonBase}
				>
					<PlusIcon className="h-5 w-5" aria-hidden="true" />
				</button>
				<button type="button" aria-label="Like" className={buttonBase}>
					<HandThumbUpIcon className="h-5 w-5" aria-hidden="true" />
				</button>
				<button type="button" aria-label="Dislike" className={buttonBase}>
					<HandThumbDownIcon className="h-5 w-5" aria-hidden="true" />
				</button>
			</div>
		</article>
	);
}
