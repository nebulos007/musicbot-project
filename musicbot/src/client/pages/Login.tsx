export function Login() {
	return (
		<main className="flex min-h-screen items-center justify-center bg-stone-900 px-6 text-stone-100">
			<div className="w-full max-w-md text-center">
				<h1 className="font-display text-3xl text-stone-100">musicbot</h1>
				<p className="mt-3 text-stone-400">
					Talk to your library. Discover new music.
				</p>
				<a
					href="/api/auth/login"
					className="mt-8 inline-flex h-11 items-center justify-center rounded-xl bg-teal-500 px-6 font-medium text-stone-900 transition-colors hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900"
				>
					Connect TIDAL
				</a>
				<p className="mt-6 text-xs text-stone-400">
					musicbot is independent and not affiliated with TIDAL.
				</p>
			</div>
		</main>
	);
}
