import { Link } from "../lib/router";

export function Settings() {
	return (
		<main className="mx-auto min-h-screen w-full max-w-2xl px-6 py-8 text-stone-100">
			<div className="flex items-center justify-between">
				<h1 className="font-display text-2xl">Settings</h1>
				<Link
					to="/"
					className="text-sm text-stone-400 hover:text-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900"
				>
					Back
				</Link>
			</div>
			<section className="mt-8 space-y-4">
				<div className="rounded-xl border border-stone-700 bg-stone-800 p-4">
					<h2 className="text-lg">BYOK API key</h2>
					<p className="mt-1 text-sm text-stone-400">
						Bring-your-own-key entry lands in Phase 2.
					</p>
				</div>
				<div className="rounded-xl border border-stone-700 bg-stone-800 p-4">
					<h2 className="text-lg">TIDAL connection</h2>
					<p className="mt-1 text-sm text-stone-400">
						Connection status + sign-out land in Phase 2.
					</p>
				</div>
			</section>
		</main>
	);
}
