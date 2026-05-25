import { useEffect, useState } from "react";
import { type SettingsStatus, getSettings, saveApiKey } from "../lib/api";
import { Link } from "../lib/router";

export function Settings() {
	const [status, setStatus] = useState<SettingsStatus | null>(null);
	const [key, setKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [justSaved, setJustSaved] = useState(false);

	useEffect(() => {
		getSettings()
			.then(setStatus)
			.catch(() => setStatus(null));
	}, []);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		const trimmed = key.trim();
		if (!trimmed || saving) return;
		setSaving(true);
		setJustSaved(false);
		try {
			await saveApiKey(trimmed);
			setKey("");
			setJustSaved(true);
			setStatus(await getSettings());
		} finally {
			setSaving(false);
		}
	}

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
				<form
					onSubmit={handleSubmit}
					className="rounded-xl border border-stone-700 bg-stone-800 p-4"
				>
					<h2 className="text-lg">BYOK API key</h2>
					<p className="mt-1 text-sm text-stone-400">
						Paste your Google AI Studio key. It's stored per-user and used only
						to make recommendations on your behalf.
					</p>
					<label
						htmlFor="byok-key"
						className="mt-4 block text-sm font-medium text-stone-100"
					>
						Google AI Studio API key
					</label>
					<input
						id="byok-key"
						type="password"
						autoComplete="off"
						value={key}
						onChange={(e) => setKey(e.target.value)}
						placeholder={
							status?.hasKey ? "A key is saved — paste a new one to replace it" : ""
						}
						className="mt-1 h-11 w-full rounded-xl border border-stone-700 bg-stone-900 px-4 text-stone-100 placeholder:text-stone-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-800"
					/>
					<div className="mt-4 flex items-center gap-3">
						<button
							type="submit"
							disabled={saving || key.trim().length === 0}
							className="flex h-11 items-center rounded-xl bg-teal-500 px-4 font-medium text-stone-900 transition-colors hover:bg-teal-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-800 disabled:opacity-50"
						>
							{saving ? "Saving…" : "Save key"}
						</button>
						<p className="text-sm text-stone-400" aria-live="polite">
							{justSaved
								? "Key saved ✓"
								: status?.hasKey
									? "A key is set"
									: "No key set"}
						</p>
					</div>
				</form>

				<div className="rounded-xl border border-stone-700 bg-stone-800 p-4">
					<h2 className="text-lg">TIDAL connection</h2>
					<p className="mt-1 text-sm text-stone-400">
						{status === null
							? "Checking…"
							: status.tidalConnected
								? "Connected ✓"
								: "Not connected"}
					</p>
				</div>
			</section>
		</main>
	);
}
