import {
	ArrowPathRoundedSquareIcon,
	ArrowsRightLeftIcon,
	BackwardIcon,
	ForwardIcon,
	PauseIcon,
	PlayIcon,
} from "@heroicons/react/24/outline";
import {
	ArrowPathRoundedSquareIcon as ArrowPathRoundedSquareSolidIcon,
	ArrowsRightLeftIcon as ArrowsRightLeftSolidIcon,
} from "@heroicons/react/24/solid";
import { tidalTrackUrl } from "../lib/api";
import { usePlayer } from "../lib/player";

// 44px tap targets, teal focus ring on stone, motion-safe press — matches
// RecommendationCard's button contract (DESIGN §5, §7).
const ctrl =
	"flex h-11 w-11 flex-none items-center justify-center rounded-xl text-stone-100 transition hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-800 motion-safe:active:scale-95 disabled:opacity-40";
const active = "text-teal-400";

function formatTime(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// Persistent mini-player bar. Mounted once at the app root (main.tsx) — above
// the router/tabs — so audio keeps playing and the bar stays visible across the
// Chat/Library tabs and the /settings route (DESIGN §3).
export function Player() {
	const {
		current,
		status,
		positionMs,
		durationMs,
		repeat,
		shuffle,
		available,
		lastError,
		togglePlay,
		next,
		prev,
		seek,
		toggleRepeat,
		toggleShuffle,
	} = usePlayer();

	// Nothing loaded yet → no bar.
	if (!current) return null;

	const playing = status === "PLAYING";

	return (
		<div
			role="region"
			aria-label="Player"
			className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-700 bg-stone-800/95 px-4 py-2 backdrop-blur"
		>
			<div className="mx-auto flex max-w-2xl flex-col gap-1">
				<div className="flex items-center gap-3">
					<div
						className="h-11 w-11 flex-none overflow-hidden rounded-lg bg-stone-700"
						aria-hidden="true"
					>
						{current.albumArtUrl ? (
							<img
								src={current.albumArtUrl}
								alt=""
								className="h-full w-full object-cover"
							/>
						) : null}
					</div>
					<div className="min-w-0 flex-1">
						<p className="font-display truncate text-stone-100">
							{current.title}
						</p>
						<p className="truncate text-sm text-stone-400">{current.artist}</p>
						{/* In-app audio is a 30s preview (TIDAL's web ceiling); the full
						    track lives in TIDAL. */}
						{available ? (
							<a
								href={tidalTrackUrl(current.id)}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-block text-xs text-teal-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-800"
							>
								Full track on TIDAL ↗
							</a>
						) : null}
					</div>

					{available ? (
						<div className="flex flex-none items-center gap-1">
							<button
								type="button"
								aria-label="Shuffle"
								aria-pressed={shuffle}
								onClick={toggleShuffle}
								className={`${ctrl}${shuffle ? ` ${active}` : ""}`}
							>
								{shuffle ? (
									<ArrowsRightLeftSolidIcon className="h-5 w-5" aria-hidden="true" />
								) : (
									<ArrowsRightLeftIcon className="h-5 w-5" aria-hidden="true" />
								)}
							</button>
							<button
								type="button"
								aria-label="Previous"
								onClick={prev}
								className={ctrl}
							>
								<BackwardIcon className="h-5 w-5" aria-hidden="true" />
							</button>
							<button
								type="button"
								aria-label={playing ? "Pause" : "Play"}
								onClick={togglePlay}
								className={ctrl}
							>
								{playing ? (
									<PauseIcon className="h-6 w-6" aria-hidden="true" />
								) : (
									<PlayIcon className="h-6 w-6" aria-hidden="true" />
								)}
							</button>
							<button
								type="button"
								aria-label="Next"
								onClick={next}
								className={ctrl}
							>
								<ForwardIcon className="h-5 w-5" aria-hidden="true" />
							</button>
							<button
								type="button"
								aria-label="Repeat"
								aria-pressed={repeat}
								onClick={toggleRepeat}
								className={`${ctrl}${repeat ? ` ${active}` : ""}`}
							>
								{repeat ? (
									<ArrowPathRoundedSquareSolidIcon
										className="h-5 w-5"
										aria-hidden="true"
									/>
								) : (
									<ArrowPathRoundedSquareIcon
										className="h-5 w-5"
										aria-hidden="true"
									/>
								)}
							</button>
						</div>
					) : (
						// SDK can't stream this account → keep Play useful via deep link.
						<a
							href={tidalTrackUrl(current.id)}
							target="_blank"
							rel="noopener noreferrer"
							className="flex-none rounded-xl border border-stone-700 px-3 py-2 text-sm text-teal-400 hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-800"
						>
							Listen on TIDAL
						</a>
					)}
				</div>

				{available ? (
					<div className="flex items-center gap-2 text-xs text-stone-400">
						<span className="tabular-nums">{formatTime(positionMs)}</span>
						<label htmlFor="player-seek" className="sr-only">
							Seek
						</label>
						<input
							id="player-seek"
							type="range"
							min={0}
							max={durationMs || 0}
							value={Math.min(positionMs, durationMs || 0)}
							onChange={(e) => seek(Number(e.target.value) / 1000)}
							className="h-1 flex-1 accent-teal-500"
						/>
						<span className="tabular-nums">{formatTime(durationMs)}</span>
					</div>
				) : null}

				{/* Surface a failed load/play instead of leaving the bar silent. */}
				{lastError ? (
					<p
						className="truncate text-xs text-red-400"
						role="status"
						title={lastError}
					>
						{lastError}
					</p>
				) : null}
			</div>
		</div>
	);
}
