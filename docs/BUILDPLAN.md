# Build Plan

> **Status:** Draft
> **Last updated:** 2026-05-26
> **Current phase:** Phase 4 (taste profile that learns) — **shipped and deployed 2026-05-26** to https://musicbot.musicbot-cs.workers.dev (remote D1 migrated: `feedback_events` ALTERed for `title`/`artist`, `taste_profile_snapshots` created — 5 tables; version `bb45ea3b`; post-deploy smoke: `/api/health` 200, `/api/chat` + `/api/feedback` 401 without a session). **Live before/after re-score still pending.** Phase 3 shipped **and deployed** 2026-05-26 to https://musicbot.musicbot-cs.workers.dev (remote D1 migrated; AI Gateway slug + Google BYOK key set; prod secrets pushed; OAuth + add-to-collection verified live). Real in-app playback (TIDAL Player SDK) is carved into **Phase 3.5**; Phase 3 ships Play as a "Listen on TIDAL" deep link. The pre-Phase-4 `searchTrack` hardening was **consciously deferred** (owner chose Phase 4 first, 2026-05-26 — see decision log).

---

## Why a build plan exists

Claude Code sessions have a finite context window. The cheaper a session is to start, the better the work tends to be. A good build plan slices the project into phases where each phase:

- Has a single user-visible outcome.
- Touches a bounded set of files.
- Names exactly which docs and files Claude should load to execute it.
- Leaves the repo in a clean, testable state at the end.

That way each phase fits in a focused session — no full-repo loads, no thrashing, no context exhaustion mid-implementation.

---

## Strategy

- **Slicing principle:** **Vertical slices by user story.** Each phase ships one PRD must-have end-to-end (DB → API → UI). Matches the week-2 / week-3 / week-4 milestones in PRD §8, which are themselves vertical.
- **Critical path:** Phase 1 (TIDAL auth + library load) → Phase 2 (BYOK LLM wired in). PRD §7 calls the TIDAL Web API + Player SDK the biggest risk; doing it first means a week-2 wall is surfaced in week 2, not in week 4.
- **Deferred on purpose:**
  - **Cold-start library animation** → Phase 6. DESIGN §7 flags it as the highest-risk piece of motion work. Phase 1 ships a static "Loaded N songs" message instead.
  - **Chat-streaming "iMessage feel"** → Phase 6, optional. PRD owner has explicitly said this is not a v1 concern.
  - **In-app playback (TIDAL Player SDK)** → **Phase 3.5** (still v1, now a **first-class, client-grade player** — revised 2026-05-26). Sequenced *after* Phase 4 (the week-4 demo feature) but ahead of the final demo if time allows. Split out of Phase 3 because it's the PRD §7 flagged biggest risk, needs a new dependency (`@tidal-music/player`) + an active subscription, and Phase 4's taste profile depends on the *feedback events*, not on playback. Phase 3 ships a "Listen on TIDAL" deep link in the meantime.
  - **Playlist building (story #5)** and **taste-avatar (story #6)** → not in this plan. Decision-log them if they come back.
- **`/clear` between phases.** Every phase boundary is a hint to clear context. Each phase's "Context to load" line is the *only* thing the next session should pull in.

---

## Phases

### Phase 0 — Scaffolding (mostly done)

**Goal:** Worker bootstrapped, deploy pipeline working, public URL in README, Cloudflare bindings (D1 / KV / AI Gateway) declared.

**Context to load:** `CLAUDE.md`, `docs/PRD.md` §6, existing `musicbot/` directory, `musicbot/wrangler.jsonc`.

**Files this phase creates/modifies:**
- `musicbot/wrangler.jsonc` — add `d1_databases`, `kv_namespaces`, AI Gateway env var
- `musicbot/src/index.ts` — verify smoke route still works after bindings added
- `README.md` — public URL, BYOK note, TIDAL developer-account setup note
- `musicbot/.dev.vars.example` — placeholder for local secrets

**Tests this phase adds:** Existing smoke test (`test/index.spec.ts`) continues to pass.

**Done-when:**
- [ ] `npm test` passes.
- [ ] `wrangler deploy` produces a public URL.
- [ ] URL in `README.md`.
- [ ] D1, KV bindings declared in `wrangler.jsonc` (resources can be created later).

**Session budget:** < 1.

**Risks / unknowns:** Cloudflare account quotas; D1 may require paid plan when real data lands.

---

### Phase 1 — Connect Tidal & see your library

The chunkiest phase in this plan. **Split into four sub-phases (1a–1d)** to keep each session focused. These are **horizontal layers, not vertical slices** — a deliberate exception to §Strategy because the alternative was a single 2+ session phase that risked context exhaustion. End-to-end user value arrives at 1d; 1a–1c leave the worker deployable but invisible. Maps to PRD §8 week-2 milestone in aggregate.

#### Phase 1a — Backend foundation ✅ Done (2026-05-21)

**Goal:** Hono router on Workers, D1 schema for users/library/sessions, `/api/health` smoke route, tests green.

**Context loaded:** PRD §6; `CLAUDE.md`; existing `musicbot/` files.

**Files created/modified:**
- `musicbot/src/index.ts` — Hono app, `/api/health`
- `musicbot/src/db/schema.sql` — `users`, `library_songs`, `sessions` (validated against local D1)
- `musicbot/test/index.spec.ts` — `/api/health` smoke test (replaces scaffold)
- `musicbot/package.json` — `hono` dependency

**Notes for future sessions:**
- KV `SESSIONS` namespace name is a misnomer — it holds OAuth-flow state (PKCE verifier, state) and TIDAL tokens; persistent session cookies live in D1 `sessions`. Renaming the binding requires recreating the namespace, so the name is intentionally not changed.
- Schema applied locally via `wrangler d1 execute musicbot --file=src/db/schema.sql --local`. Remote D1 has **not** been seeded — run with `--remote` before the first deploy that needs it.

#### Phase 1b — TIDAL OAuth + session ✅ Done (2026-05-21)

**Goal:** A user hits `/api/auth/login` → completes TIDAL OAuth 2.1 (authorization code + PKCE) → returns to `/api/auth/callback` with a code → app exchanges for tokens, stores them in KV, creates a D1 session row, sets a session cookie, redirects to `/`. No library sync yet.

**Files created/modified:**
- `musicbot/src/routes/auth.ts` — `/api/auth/login` + `/api/auth/callback`
- `musicbot/src/lib/tidal.ts` — endpoint constants, PKCE helpers, `exchangeCode`, `refreshTokens`, `fetchMe`, `refreshIfNeeded`
- `musicbot/src/lib/session.ts` — `createSession`, `setSessionCookie`, `requireSession` middleware
- `musicbot/src/index.ts` — mount `authRouter` at `/api/auth`
- `musicbot/src/env.d.ts` — augment `Cloudflare.Env` with `TIDAL_CLIENT_ID` / `TIDAL_CLIENT_SECRET` (not picked up by `wrangler types` because they live in `.dev.vars`, not `wrangler.jsonc`)
- `musicbot/test/auth.spec.ts`, `musicbot/test/session.spec.ts` — 10 new tests (all green)
- `musicbot/test/tsconfig.json` — include `../src/env.d.ts` so the augmentation reaches test compilation

**Notes for future sessions:**
- **Endpoint URLs (confirmed against `tidal-music/tidal-sdk` Auth.md + Developer Portal search, 2026-05-21):** authorize `https://login.tidal.com/authorize`, token `https://auth.tidal.com/v1/oauth2/token`, /me `https://openapi.tidal.com/v2/users/me`. The `listen.tidal.com`/`r_usr w_usr` flow on the web is the *unofficial* reverse-engineered client — do not copy from it.
- **Scope strings are dot-separated:** `user.read collection.read collection.write`. `user.read` was added beyond the 1a note ("collection read + write") because the callback needs `/v2/users/me` to identify the user before writing the D1 row. If the TIDAL portal app isn't allowlisted for `user.read`, the call will fail and Phase 1b will need a different user-ID strategy (decode token, defer to 1c).
- **Client secret is sent in the form body** (`client_secret=…`), not Basic auth. Works for the registered confidential client; a strict public client would reject this and need PKCE-only — handle if it surfaces.
- **`/v2/users/me` returns JSON:API shape** `{ data: { id: "..." } }`. The lib also tolerates flat `{ id }` as a fallback.
- **PKCE entry TTL:** 600s in KV; deleted on successful callback. State + verifier are stored under `pkce:<state>`; tokens under `tidal_tokens:<userId>`.
- **Session cookie:** `mb_session`, HttpOnly, SameSite=Lax, Secure when scheme is https, 30-day TTL. Cookie stores only the session id; the row in D1 `sessions` is the source of truth.
- **Tests mock external fetches with `fetchMock` from `cloudflare:test`** — `fetchMock.activate()` + `disableNetConnect()` in `beforeAll`, route-specific `.intercept(...).reply(...)` per test, `assertNoPendingInterceptors()` in `afterEach`.
- **Manually verified end-to-end against a real TIDAL account on 2026-05-21**: login → consent → callback → user row written (real `tidal_user_id`) → session row written (30-day expiry) → cookie set → redirect to `/`. The scaffold `public/index.html` still loads at `/` (its H1 says "404 Not Found" because the scaffold JS fetches `/message`, which Hono 404s — harmless cosmetic only; Phase 1d replaces the page).

**Done-when:**
- [x] Hitting `/api/auth/login` redirects to TIDAL's auth URL with a valid PKCE challenge (verified by test against the real workerd runtime).
- [x] `/api/auth/callback` with a valid code creates a user row, stores tokens in KV, sets a session cookie, redirects to `/`.
- [x] PKCE verifier auto-expires from KV (TTL set on write).
- [x] Tests pass; `npm test` green (11/11).

#### Phase 1c — Library sync ✅ Done (2026-05-21)

**Goal:** Authenticated user's TIDAL library is fetched (paginated, with 429 backoff) and persisted to D1. `/api/library/count` returns the count.

**Files created/modified:**
- `musicbot/src/routes/library.ts` — `POST /api/library/sync`, `GET /api/library/count`, both behind `requireSession()`
- `musicbot/src/lib/tidal.ts` — added `TIDAL_API_BASE`, `LibrarySong`, `fetchLibraryPage`, `fetchAllLibrary` with `Retry-After`-respecting bounded retry (max 3)
- `musicbot/src/index.ts` — mounted `libraryRouter` at `/api/library`
- `musicbot/test/library.spec.ts` — auth gating, multi-page sync, 429 retry, idempotent re-sync, count isolation across users
- `musicbot/test/tidal.spec.ts` — backoff honors `Retry-After`, defaults to 1s when absent, pagination follows `links.next`

**Notes for future sessions:**
- **Endpoint resolved against the live `tidal-api-oas.json` (2026-05-21):** `GET https://openapi.tidal.com/v2/userCollectionTracks/me/relationships/items?include=items,items.artists&countryCode=US&locale=en-US`. The `me` literal is documented in the spec ("Use `me` for the authenticated user's resource"), so we do **not** need the TIDAL user id at fetch time. The older `/userCollections/{id}/relationships/tracks` route is marked deprecated in the spec.
- **Pagination:** cursor-based. The response's `links.next` is a path **relative to `/v2`** (e.g. `/userCollectionTracks/...?page[cursor]=...`). `fetchLibraryPage` prepends `TIDAL_API_BASE` only if the path doesn't already start with `http`. Tests assume the same shape.
- **JSON:API parsing:** track titles come from the `tracks` resource in `included[]` (keyed by `tracks:<id>`); artist names come from the first id in `track.relationships.artists.data` resolved against `artists:<id>` in the same `included[]`. Album / album-art are intentionally `NULL` in 1c — Phase 2 fills them when displaying recs.
- **Idempotency:** `INSERT … ON CONFLICT(user_id, song_id) DO UPDATE SET title, artist, added_at, synced_at = excluded.*`. The PK already exists in the 1a schema, so no migration. The idempotency test sleeps 1.1s between syncs because `synced_at` is INTEGER seconds — a faster re-run could land in the same second and look like no-op.
- **429 backoff:** `parseRetryAfter` honors numeric seconds and HTTP-date forms; falls back to 1s when missing. Capped at 3 retries per page. Tests inject a fake `sleep` so they don't actually wait.
- **Mocking gotcha:** undici's MockClient normalizes (sorts) query params, so `path:` matchers must be regexes over the pathname only — literal strings with a query won't match. Use FIFO interceptors when two requests share a pathname (e.g. paginated calls).
- **Subrequest limits not yet stress-tested.** A free-plan Worker caps at 50 subrequests per request; a 1000-song library at the TIDAL default 20-per-page would need 50 calls. If real libraries breach this, the BUILDPLAN risk flagged (Queues / cursor resumption) becomes Phase 1c.1.
- **Manual end-to-end verification deferred** — phase shipped on tests only. Will be exercised the first time Phase 1d's UI hits `POST /api/library/sync`. Remote D1 still has not been seeded (1a note still applies).

**Done-when:**
- [x] Sync paginates the full library and writes to D1.
- [x] `GET /api/library/count` returns the correct count.
- [x] Re-running sync is idempotent.
- [x] Tests pass (21/21).

#### Phase 1d — React frontend ✅ Done (2026-05-22)

**Goal:** `/login` → "Connect Tidal" → OAuth round-trip → lands on `/` showing tabbed Chat/Library, gear → `/settings`, "Loaded N songs" header, ≥3 placeholder recommendation cards. *Used the static "Loaded N songs" fallback, not the cold-start animation (deferred to Phase 6).*

**Files created/modified:**
- `musicbot/vite.config.ts` — `outDir: "public"`, `publicDir: false`, plugins `react()` + `tailwindcss()`
- `musicbot/index.html` — Vite source entry (preconnects Google Fonts, loads Fraunces, mounts `<div id="root">`)
- `musicbot/src/client/{main,App}.tsx` — React entry + 3-route switch
- `musicbot/src/client/lib/router.tsx` — tiny pushState-based router (`usePath`, `navigate`, modifier-aware `<Link>`)
- `musicbot/src/client/lib/api.ts` — cookie-authed fetch wrapper; 401 → `window.location = "/login"`
- `musicbot/src/client/pages/{Login,Chat,Settings}.tsx`
- `musicbot/src/client/components/RecommendationCard.tsx` — Heroicons + 44×44 buttons, teal focus rings on stone-900
- `musicbot/src/client/components/RecommendationCard.spec.tsx` — 4 cases
- `musicbot/src/client/styles.css` — `@import "tailwindcss"` + `@theme` for Fraunces display font
- `musicbot/src/client/test-setup.ts` — `jest-dom/vitest` + manual `afterEach(cleanup)`
- `musicbot/tsconfig.client.json` — extends root, adds DOM lib, resets `exclude`
- `musicbot/tsconfig.json` — excludes `src/client` (Worker code stays DOM-free)
- `musicbot/wrangler.jsonc` — `assets.binding: "ASSETS"` + `not_found_handling: "single-page-application"`
- `musicbot/src/index.ts` — Hono `notFound` proxies non-`/api` to `env.ASSETS.fetch` (the actual mechanism that makes SPA deep-links work; see decision log)
- `musicbot/vitest.config.mts` (+ `vitest.workers.config.mts`, `vitest.client.config.mts`) — Vitest workspaces (workerd pool + happy-dom)
- `musicbot/package.json` — added `react`, `react-dom`, `@headlessui/react`, `@heroicons/react`, `vite@^7`, `@vitejs/plugin-react@^5`, `tailwindcss@^4`, `@tailwindcss/vite@^4`, `@types/react@^19`, `@types/react-dom@^19`, `@testing-library/react@^16`, `@testing-library/jest-dom@^6`, `happy-dom@^15`. New scripts: `build`, `dev` (= `vite build && wrangler dev`), `deploy` (= `vite build && wrangler deploy`), `typecheck`.
- `musicbot/.gitignore` — `public/` (build output)
- `README.md` — extended TIDAL setup with scopes, prod redirect URI, remote D1 seed; added "Running the app" section

**Notes for future sessions:**
- **SPA fallback needs the ASSETS binding + a Hono catch-all** — `not_found_handling: "single-page-application"` alone does NOT serve `/index.html` for `/login`/`/settings` when there's a `main` Worker. The Worker is consulted first; Hono's default 404 wins. The fix is the `app.notFound` handler in `src/index.ts` that calls `c.env.ASSETS.fetch(c.req.raw)` for non-`/api/*` paths. `not_found_handling` is what makes that ASSETS.fetch return `/index.html` for unknown paths.
- **Vite source `index.html` lives at `musicbot/index.html`, not `musicbot/public/index.html`** — Vite expects entry HTML at its `root`. `public/` is the *output*. `publicDir: false` disables Vite's "copy public/ as static assets" semantics so the output dir and the (now-defunct) static-asset dir don't collide.
- **Vite pinned to v7, plugin-react to v5.** Vitest 3.2.x (already in the repo from Phase 1a) caps its vite dep at `^7.0.0-0`. Bumping Vite to 8 would have required vitest 4, which would have re-opened the Workers-test surface for no real benefit.
- **Custom router, no `react-router-dom`.** Three routes (`/login`, `/`, `/settings`) don't justify a dep. `lib/router.tsx` is ~30 lines: `usePath` listens to `popstate` + a custom `musicbot:navigate` event; `navigate(to)` calls `pushState` then dispatches; `<Link>` respects modifier-clicks (cmd-click opens new tab).
- **Vitest workspaces over a single config.** `vitest.config.mts` is now a shell with `test.projects: [workers, client]`. The Workers project keeps the Phase 1a-1c posture (workerd pool, `wrangler.jsonc` binding). The client project adds happy-dom + `@vitejs/plugin-react` and points at `src/client/**/*.spec.{ts,tsx}`. `globals: false` is kept — `@testing-library/react` auto-cleanup is wired explicitly in `test-setup.ts`.
- **`<img alt="">` is `role="presentation"`, not `role="img"`** — the four RecommendationCard tests use `container.querySelector("img")` for the decorative album art rather than `getByRole("img")`. Bit it on the first test run.
- **Library auto-syncs on first visit to `/`.** `Chat.tsx` calls `getLibraryCount()` on mount; if `count === 0`, it fires `POST /api/library/sync` and re-renders with the new count. The "Loaded N songs" line uses `aria-live="polite"` so screen readers announce the sync completion (DESIGN §5).
- **No HMR yet.** `npm run dev` = `vite build && wrangler dev`. The build adds ~500 ms per dev launch; cheap given Phase 1d's scope. Upgrade to a Vite dev server with `/api/*` proxy when frontend iteration speed actually hurts.
- **End-to-end smoke deferred.** Tests pass (25/25), typecheck clean, `npm run build` produces `public/index.html` + `assets/*` (~75 KB gzipped JS), `wrangler dev` serves `/login`, `/`, `/settings`, `/api/health`, and `/api/library/count` (401 without cookie) correctly. The actual OAuth round-trip against a real TIDAL account was last verified in 1b on 2026-05-21; 1d only adds a `<a href="/api/auth/login">` to that flow. First combined verification will happen the first time Phase 2 wires the chat input to a real LLM call.

**Done-when:**
- [x] `/login` shows "Connect Tidal".
- [x] OAuth completes and lands on `/` (path unchanged from 1b; 1d's only new link is the `<a href="/api/auth/login">` in Login.tsx).
- [x] `/` shows tabs, gear → `/settings`, "Loaded N songs" line.
- [x] ≥3 placeholder cards render (`PLACEHOLDER_RECS` has 3).
- [x] `npm test` passes (25/25); `npm run build` clean.

---

### Phase 2 — Talk to it, get real recommendations

**Goal:** User enters a natural-language prompt; the app calls their BYOK LLM with library context and replaces placeholder cards with real recommendations. Maps to first half of PRD §8 week-3 milestone.

**Context to load:** PRD §4 story 1, §6 (AI Gateway, BYOK); DESIGN §3 (chat bubble — *no streaming yet*), §6 (chat width on desktop); `CLAUDE.md`; Phase 1a–1d files.

**Files created/modified (actuals, 2026-05-25):**
- `musicbot/src/lib/llm.ts` — `GEMINI_MODEL` (`gemini-2.5-flash`), `buildGatewayUrl`, `generateRecommendations` (structured-JSON Gemini call via AI Gateway)
- `musicbot/src/lib/promptTemplates.ts` — `summarizeLibrary` (count + top-40 artists, capped at `MAX_SUMMARY_CHARS`), `buildRecommendationPrompt`
- `musicbot/src/lib/tidal.ts` — `searchTrack` (catalog lookup → canonical title/artist/album/art + track id) and `byokKvKey`
- `musicbot/src/routes/chat.ts` — `POST /api/chat` (key check → library summary → LLM → catalog enrichment, capped at 5 recs)
- `musicbot/src/routes/settings.ts` — `GET`/`POST /api/settings` (KV-backed BYOK key; status is write-only)
- `musicbot/src/index.ts` — mounted `chatRouter` + `settingsRouter`
- `musicbot/src/client/lib/api.ts` — `sendChat`, `getSettings`, `saveApiKey`, `NoApiKeyError`
- `musicbot/src/client/pages/Chat.tsx` — controlled input, message thread, real recs replace placeholders
- `musicbot/src/client/pages/Settings.tsx` — visible-label BYOK form + TIDAL status
- `musicbot/src/client/components/RecommendationCard.tsx` — `Recommendation` gained optional `album`
- Tests: `test/{llm,promptTemplates,settings,chat}.spec.ts`, `src/client/pages/Chat.spec.tsx`

**Notes for future sessions:**
- **AI Gateway → Gemini path:** `{AI_GATEWAY_BASE_URL}/google-ai-studio/v1beta/models/gemini-2.5-flash:generateContent`, Google key in the `x-goog-api-key` header. **Must be `/v1beta`, not `/v1`** — the stable `/v1` `GenerationConfig` rejects `responseMimeType`/`responseSchema` as unknown fields (confirmed on the first live call 2026-05-25; CF's doc example showing `/v1` is misleading for structured output). `AI_GATEWAY_BASE_URL` is a `wrangler.jsonc` var (in the generated `Env` after `wrangler types`); its slug is now `musicbot` (set 2026-05-25).
- **Authenticated gateway:** the gateway runs in Authenticated mode, so each call also sends `cf-aig-authorization: Bearer <AI_GATEWAY_TOKEN>`. `AI_GATEWAY_TOKEN` is a `.dev.vars` / `wrangler secret` secret (typed optional in `env.d.ts`); `generateRecommendations` adds the header only when the token is present, so an open gateway and the tests still work without it. A `.dev.vars` change needs a `wrangler dev` restart to take effect.
- **BYOK key lives in the `SESSIONS` KV namespace** under `byok_key:<userId>` (alongside `tidal_tokens:` / `pkce:`). `GET /api/settings` returns only `{ hasKey, tidalConnected }`, never the raw key.
- **Catalog lookup (verified against live `tidal-api-oas.json` 2026-05-25):** `GET /v2/searchResults/{query}?countryCode=US&include=tracks,tracks.albums,tracks.albums.coverArt,tracks.artists`. Takes the first `data.relationships.tracks.data[]` id, resolves it through `included[]` (reuses Phase 1c's `indexIncluded`). **Cover art is to-one** so `album.relationships.coverArt.data` is a bare object, not an array — `relFirstId` handles both. `searchTrack` degrades to `null` (card shows LLM text, no art) on any non-2xx / no-hit / missing nested include, so a catalog miss never fails the chat. This is the helper Phase 5 reuses for library album-art backfill.
- **Single-shot chat (confirmed with PRD owner):** each `/api/chat` is independent — library summary + that one prompt. The visible thread lives only in `Chat.tsx` React state; nothing is persisted and prior turns aren't sent to the LLM. Recommendation persistence/history is Phase 4/5.
- **Chat bubbles use `rounded-2xl`, not DESIGN §4's literal `rounded-full`** — `rounded-full` clips multi-line replies into a pill. `rounded-2xl` is the iMessage-style radius the brief actually means. No `ChatBubble.tsx` component yet (that file is Phase 6); bubbles are inline in `Chat.tsx`.
- **Manual end-to-end + deploy deferred** (same posture as 1c/1d): all 46 tests green, typecheck clean, `vite build` clean (~76 KB gzipped JS), both external calls mocked. First real run needs the user to (1) create an AI Gateway and replace `REPLACE_ME` in `wrangler.jsonc`, (2) paste a Google AI Studio key in `/settings`.

**Done-when:**
- [x] User sets a Google AI Studio key in `/settings` (BYOK form → `POST /api/settings`; round-trip tested).
- [x] A prompt updates the cards with real recs (title, artist, album art via TIDAL catalog lookup) — covered by `chat.spec.ts` + `Chat.spec.tsx`; live run pending the two prerequisites above.
- [x] Reply lands as a single message — no streaming.
- [x] Tests pass (46/46). **Deploy pending** AI Gateway slug + real key.

**Session budget:** 1–2.

**Risks / unknowns:** Prompt quality before any feedback exists (PRD §7 cold-start risk) — untested until a live key runs. 3-level nested include (`tracks.albums.coverArt`) may not be honored by TIDAL; `searchTrack` degrades gracefully if so — confirm on first real call.

---

### Phase 3 — Act on a recommendation

**Goal:** Like / dislike / add-to-library / play buttons on each card all work and write feedback events to D1. Maps to second half of PRD §8 week-3 milestone.

**Context to load:** PRD §4 stories 2+3; DESIGN §3 (card), §5 (a11y — color + icon, 44px tap targets); Phase 1a–1d + Phase 2 files.

**Files created/modified (actuals, 2026-05-26):**
- `musicbot/src/db/schema.sql` — added append-only `feedback_events` (`id`, `user_id`, `song_id`, `kind`, `created_at`) + `idx_feedback_user`
- `musicbot/src/lib/tidal.ts` — `addToLibrary(trackId, {accessToken, sleep?})`: JSON:API POST with 429 backoff (reuses `parseRetryAfter`/`MAX_RETRIES`), 409→success
- `musicbot/src/routes/feedback.ts` — `POST /api/feedback` behind `requireSession`; like/dislike write events, `add` calls `addToLibrary` first then writes
- `musicbot/src/index.ts` — mounted `feedbackRouter` at `/api/feedback`
- `musicbot/src/client/lib/api.ts` — `sendFeedback(songId, kind)`, `tidalTrackUrl(id)` (deep-link helper Phase 5 reuses)
- `musicbot/src/client/components/RecommendationCard.tsx` — interactive: Play `<a>` deep link, like/dislike toggle (outline→solid icon + teal fill + `aria-pressed`), add (Plus→Check, "Added to library"), `motion-safe:active:scale-95`, actions disabled for unresolved recs
- `musicbot/src/client/pages/Chat.tsx` — passes `onAction={(kind) => sendFeedback(rec.id, kind)}`
- Tests: `test/{feedback,tidal-add}.spec.ts`, extended `src/client/components/RecommendationCard.spec.tsx`

**Notes for future sessions:**
- **Play is a "Listen on TIDAL" deep link, not the Player SDK.** Real in-app playback is **Phase 3.5** (see decision log 2026-05-26). `tidalTrackUrl(id)` → `https://listen.tidal.com/track/{id}`, opened in a new tab. Phase 5's library rows reuse this helper until 3.5 swaps it for the SDK.
- **Add-to-library endpoint verified against the live `tidal-api-oas.json` (2026-05-26):** `POST /v2/userCollectionTracks/me/relationships/items?countryCode=US`, `content-type: application/vnd.api+json`, body `{ "data": [ { "type": "tracks", "id": "<id>" } ] }` (1–20 items). The GitHub discussion #90 ("only albums/artists/playlists writable") is **stale** — the current spec has POST/DELETE on the tracks relationship. `me` is the documented authenticated-user literal (same as Phase 1c's GET), and a POST against `me` is **confirmed working live (2026-05-26)** — clicking a rec card's + added the track to the real TIDAL collection. `409` is treated as success (already in collection); an optional `Idempotency-Key` header exists but we don't send one (internal 429 retries re-send the same idempotent body).
- **`feedback_events` is an append-only log** (`id INTEGER PRIMARY KEY AUTOINCREMENT`). like/dislike are mutually exclusive in the UI and post **only on activation** — deactivation/toggle-off is visual-only (no "unlike" event). Phase 4 takes the latest signal per (user, song). No CHECK constraint on `kind`; the route validates `{like,dislike,add}` (matches the rest of the schema's no-CHECK style).
- **`add` ordering:** the route calls `addToLibrary` *before* inserting the event, so a recorded `add` always implies the TIDAL write succeeded; on failure it returns 502 and writes nothing, and the card optimistically-then-reverts the "added" fill. like/dislike write directly (no side effect).
- **Actionable = numeric id.** The card gates Play/Add/Like/Dislike on `/^\d+$/.test(rec.id)` — real TIDAL track ids are numeric, while placeholders (`p1`) and catalog misses (`llm:0`) aren't, so those render with the actions disabled (and no live Play link). This is why the pre-existing card tests (id `test-1`) still pass: Play falls back to a disabled `<button>`, still role=button name="Play".
- **44px assertion is a class check, not computed style.** Tailwind isn't compiled in the happy-dom unit run, so the test asserts each control carries `h-11 w-11` (the 44px contract) rather than reading `getComputedStyle`.
- **Deployed 2026-05-26** to https://musicbot.musicbot-cs.workers.dev. 66/66 tests green, typecheck clean. Remote D1 migrated via `wrangler d1 execute musicbot --remote --file=src/db/schema.sql` (idempotent — created `feedback_events` plus the never-seeded earlier tables; 4 tables now present). AI Gateway slug in `wrangler.jsonc`, Google BYOK key in KV via `/settings`. Post-deploy smoke: `/api/health` 200, `POST /api/feedback` 401 without a session (route mounted + gated). Prod secrets (`TIDAL_CLIENT_ID`/`_SECRET`, `AI_GATEWAY_TOKEN`) were missing on the first deploy — pushed via `wrangler secret put` (they only lived in `.dev.vars`); the empty `client_id` was the cause of TIDAL's generic "1005" error. **Confirmed live 2026-05-26:** full OAuth round-trip + clicking a rec card's + added the track to the real TIDAL collection (POST-against-`me` works).

**Done-when:**
- [x] All four buttons functional, ≥44px on a 390px viewport (`h-11 w-11`).
- [x] Like / dislike change icon **and** fill (outline→solid + teal `aria-pressed`, not color alone — DESIGN §5).
- [x] Add-to-library calls the verified TIDAL collection-add endpoint (live POST-to-`me` confirmation pending).
- [x] Feedback events written to D1 (`feedback.spec.ts`).
- [x] Tests pass (66/66); deployed to https://musicbot.musicbot-cs.workers.dev (remote D1 migrated). Add's POST-to-`me` confirmed live — track added to a real TIDAL collection.

**Session budget:** 1.

**Risks / unknowns:** POST-to-`me` for collection add unconfirmed live (fallback: real collection id); tap-target tuning without a real iPhone in hand (DESIGN §7).

---

### Phase 3.5 — In-app playback (TIDAL Player SDK)

**Goal:** Real, **client-grade** in-app playback users actually enjoy — replaces the "Listen on TIDAL" deep link. Play/pause, skip, scrubber, a queue built from the recommendation list, repeat/shuffle. Audio plays uninterrupted in the background as the user moves between the Chat/Library tabs and routes. Also captures listen signal (full plays, early skips, repeats) for the taste profile. (Playback is a **first-class v1 feature** as of 2026-05-26 — see decision log; PRD §3 / DESIGN §3 revised.)

**Context to load:** PRD §3 (in-app playback as a first-class feature), §6 (Player SDK limits); DESIGN §3 (audio player controls); Phase 3 + Phase 5 files (Library `play` wiring).

**Files this phase creates/modifies (planned):**
- `musicbot/package.json` — `@tidal-music/player` (+ any auth-handoff dep) — **ask before adding**
- `musicbot/src/client/lib/player.ts` — SDK init + a player store/hook: current track, queue, position, `play`/`pause`/`seek`/`next`/`prev`/`toggleRepeat`/`toggleShuffle`; token handoff from the Worker-held OAuth tokens
- `musicbot/src/client/components/Player.tsx` — **persistent mini-player bar** (now-playing + controls), **mounted once at the app root** (above the router/tabs) so it stays visible and audio survives tab/route changes. Mind the 390px clash with the Chat tab's bottom-pinned input (DESIGN §6).
- `musicbot/src/client/components/RecommendationCard.tsx` + `LibrarySongRow.tsx` — Play enqueues/plays via the store instead of the deep link
- listen-signal capture → `feedback_events` or a new `listen_events` table (full-play / early-skip / repeat)
- a small backend surface (route or KV) only if the SDK needs server-mediated credentials

**Done-when:**
- [ ] Play starts real in-app playback on a subscribed account; play/pause, skip, scrubber, queue, repeat/shuffle all work.
- [ ] A persistent mini-player bar stays visible with working controls across Chat/Library tab + route switches, and audio never interrupts (player lives at the app root).
- [ ] Graceful fallback (deep link or preview) when the account has no active subscription.
- [ ] In-app listen signal captured for the taste profile (Phase 4 can consume it).
- [ ] Tests pass; deployed.

**Session budget:** 2–3 (bumped from 1–2 — full controls + queue + SDK auth handoff; PRD §7's flagged biggest risk).

**Risks / unknowns:** PRD §7's biggest risk. SDK auth handoff from Worker-held OAuth tokens to the browser; subscription gating for full-track playback (preview / deep-link fallback otherwise); queue + playback state management; skip-detection precision (PRD §6, ~1–2s). **Out of scope even here:** catalog/search browsing — we build a player, not a Tidal replacement.

---

### Phase 4 — Taste profile that learns

**Goal:** Recommendations measurably differ between session 1 (cold start) and session 5 (after feedback) because the LLM prompt is enriched with a derived taste profile. Maps to PRD §8 week-4 demo milestone.

**Context to load:** PRD §3 (success criteria), §4 story 2, §7 (cold-start risk); DESIGN §3; Phase 1a–1d + Phases 2–3 files.

**Files created/modified (actuals, 2026-05-26):**
- `musicbot/src/lib/tasteProfile.ts` — `deriveTasteProfile(events)` → `{ lovedArtists, dislikedArtists, dislikedTracks }`; latest-signal-per-song, like/add positive + dislike negative, never excludes an also-loved artist, capped lists. **Artist/track level only** — genres/eras aren't derivable (D1 holds title+artist; album/genre deferred 2026-05-21), so the plan's "genres/eras" wording is unmet by design.
- `musicbot/src/lib/promptTemplates.ts` — `buildRecommendationPrompt` gains optional `tasteProfile`; injects a "Taste profile…" block (lean-into / avoid / exact-track exclusions) + a system instruction to be more adventurous and honor exclusions. Empty profile (cold start) → byte-identical to the pre-Phase-4 prompt.
- `musicbot/src/routes/chat.ts` — loads feedback events (oldest-first), derives the profile, injects it, and writes a `taste_profile_snapshots` row (best-effort `.catch(() => {})`).
- `musicbot/src/db/schema.sql` — **added `title`/`artist` (nullable) to `feedback_events`** (beyond the listed files — see decision log) + `taste_profile_snapshots` table + `idx_taste_snapshots_user`.
- `musicbot/src/routes/feedback.ts` + `src/client/lib/api.ts` (`sendFeedback`) + `src/client/pages/Chat.tsx` — thread `title`/`artist` through `POST /api/feedback` so the profile can name what was liked/disliked.
- Tests: `test/tasteProfile.spec.ts` (7), extended `test/promptTemplates.spec.ts` (+2), `test/chat.spec.ts` (+2, captures the Gemini request body), `test/feedback.spec.ts` (+1).

**Notes for future sessions:**
- **"Profile updates after every feedback event" = derived on demand.** The profile is recomputed from the full `feedback_events` log on every `/api/chat`, so any new event is reflected on the next chat; the snapshot row captures the profile that drove each request. No materialized per-event profile.
- **Verifying "recs differ from baseline" without a real LLM:** the mock LLM is static, so "recs differ" is verified at the *prompt* the LLM receives — `chat.spec.ts` intercepts the Gemini POST via an undici `.reply((opts) => …)` callback and asserts the cold-start prompt has no taste block while the 10-feedback prompt carries the loved (`Alvvays`) + disliked (`Imagine Dragons`) artists. The prompt is what the AI Gateway logs, so this is the same surface the done-when's "verifiable via AI Gateway log" points at.
- **Feedback now needs `title`/`artist`.** `RecommendationCard` already passed the full `rec` to `onAction`; `Chat.tsx` had been dropping it. Columns are nullable so older rows / non-rec feedback are fine.
- **Remote D1 migration is a manual one-time `ALTER`** (`ALTER TABLE feedback_events ADD COLUMN title TEXT; ALTER TABLE feedback_events ADD COLUMN artist TEXT;`) because `CREATE IF NOT EXISTS` won't add columns to the existing live table. `taste_profile_snapshots` is created by re-running `schema.sql --remote`. **Applied 2026-05-26** — the ALTER lands the columns *after* `created_at` (cid 5/6), a harmless physical-order divergence from `schema.sql` since all SQL names columns explicitly.

**Done-when:**
- [x] Profile updates after every feedback event (derived on demand; snapshot per chat).
- [x] LLM prompt visibly carries taste signals — asserted against the captured Gemini request body (`chat.spec.ts`).
- [x] Recs after 10 feedback events differ from cold-start recs in tests (verified at the prompt level — cold-start has no taste block, 10-feedback prompt carries loved/disliked artists).
- [x] Demo can show before / after side-by-side (`taste_profile_snapshots` captures each chat's profile; re-score the [[project-coldstart-rec-baseline]] prompts live to show the lift).
- [x] Tests pass (78/78), typecheck + build clean. **Deployed 2026-05-26** to https://musicbot.musicbot-cs.workers.dev; remote D1 migrated (`feedback_events` + `title`/`artist`, `taste_profile_snapshots` created). Live before/after re-score still pending.

**Session budget:** 1–2.

**Risks / unknowns:** Cold-start quality without play counts (PRD §7 — needs to be tested early); over-fitting to a single dislike; profile drift if an event is mis-clicked. **Live before/after re-score still pending** — the real proof of Phase 4 is re-running the gut-check prompts on prod and beating the baseline's `Discovery 1` on "like X but different".

---

### Phase 5 — Library tab (TIDAL library browse + recommendation history)

**Goal:** Two-section Library tab: (1) **My library** — paginated browse of the user's synced TIDAL library with working play buttons; (2) **History** — past recommendations with the ratings the user gave. Maps to PRD §4 story #4 (Should-have) and the soft goal in PRD §3 of "users listen *inside* our app" as a taste-signal capture surface. Uses Phase 3's `tidalTrackUrl` deep-link for Play (upgrades to the **Phase 3.5** Player SDK if that's landed by then) and Phase 2's TIDAL catalog-lookup helper (for album-art enrichment — Phase 1c left `album` / `album_art_url` NULL).

**Context to load:** PRD §3 (in-app listening as signal capture), §4 story 4; DESIGN §2 (Library tab), §6 (1/2/3-col grid); Phase 1a–1d + Phase 2 + Phase 3 files.

**Files this phase creates/modifies:**
- `musicbot/src/routes/library.ts` — add `GET /api/library/songs?cursor=...&limit=...` (paginated, newest-first by `added_at`)
- `musicbot/src/routes/history.ts` — paginated rec history (newest first)
- `musicbot/src/lib/tidal.ts` — `enrichSongs(songIds)` for album / album-art backfill on demand (reuse Phase 2's catalog-lookup helper)
- `musicbot/src/client/pages/Chat.tsx` — wire the Library tab to render the two sub-sections
- `musicbot/src/client/components/LibrarySongRow.tsx` — compact row with art, title, artist, play button (reuses Phase 3's play wiring)
- `musicbot/src/client/components/HistoryGrid.tsx` — responsive 1/2/3-col grid for past recs
- `musicbot/src/client/components/RecommendationCard.tsx` — read-only "history" variant showing the rating given

**Tests this phase adds:**
- `library.spec.ts` — extend with `/api/library/songs` pagination + ordering by `added_at`
- `history.spec.ts` — paginated, includes feedback, newest first
- `LibrarySongRow.spec.tsx` (client project) — renders title/artist/art, play button has accessible label
- `HistoryGrid.spec.tsx` — column count correct at `md` + `lg`

**Done-when:**
- [ ] Library tab shows the synced TIDAL library, paginated, with album art enriched on demand.
- [ ] Each library row has a Play button (same helper rec cards use — `tidalTrackUrl` deep link, or the Phase 3.5 Player SDK if landed).
- [ ] Library tab also shows past recs newest-first, with the rating the user gave.
- [ ] Responsive: 1 col phone, 2 col tablet, 3 col desktop for the history grid; library rows stack on phone, wider on tablet+.
- [ ] Tests pass; deployed.

**Session budget:** 1–2.

**Risks / unknowns:** Catalog-lookup batch size + 429 behavior when enriching a large library (carries forward Phase 1c's subrequest-cap concern); two-section layout on a 390px viewport without crowding the chat-input affordance.

---

### Phase 6 — Polish & demo prep

**Goal:** Cold-start animation lands (with reduced-motion fallback), README has demo + PRD videos, architecture diagram is current. Chat-streaming feel only if time remains.

**Context to load:** PRD §8 week-4 demo; DESIGN §2 (cold-start hero), §3 (streaming reply, optional), §5 (`prefers-reduced-motion`, `aria-live`).

**Files this phase creates/modifies:**
- `musicbot/src/client/components/ColdStartAnimation.tsx`
- `musicbot/src/client/pages/Chat.tsx` — show animation only on first session
- `musicbot/src/client/components/ChatBubble.tsx` — *optional* token streaming + `aria-live="polite"`
- `musicbot/src/routes/chat.ts` — *optional* SSE response
- `README.md` — demo video, PRD video, architecture diagram link
- `docs/architecture.md` — regenerated diagram

**Tests this phase adds:**
- `ColdStartAnimation.spec.tsx` — degrades to static text under `prefers-reduced-motion`
- `ChatBubble.spec.tsx` (if streaming shipped) — announces via `aria-live`

**Done-when:**
- [ ] Animation runs once on first session; static text otherwise.
- [ ] `prefers-reduced-motion` honored.
- [ ] README links demo + PRD videos and points at architecture diagram.
- [ ] Tests pass; deployed.

**Session budget:** 1–2.

**Risks / unknowns:** Animation eats time — drop streaming first, then animation polish, before letting this phase block the demo.

---

## Decision log

| Date | Phase touched | Change | Reason |
|---|---|---|---|
| 2026-05-07 | All | Initial plan | Vertical slicing chosen over horizontal/hybrid because PRD §8 milestones are already vertical. |
| 2026-05-07 | Phase 1 | Cold-start animation deferred to Phase 6 | DESIGN §7 flags it as the riskiest motion work; Phase 1 already chunky. Static "Loaded N songs" fallback meets the week-2 milestone. |
| 2026-05-07 | — | Story #5 (playlist) and #6 (taste avatar) excluded from this plan | Should/Could-haves below the v1 demo bar; will return via decision log if scope changes. |
| 2026-05-11 | — | YouTube-playlist free tier deferred to v2 | Surfaced during planning. Strategically interesting (real free tier, not just trial mode) but doubles v1 scope and serves no v1 user — the demo runs on the developer's premium-service account. Captured in PRD §3 v2 vision. |
| 2026-05-11 | All | v1 reference platform swapped from Apple Music to Tidal | Apple Developer account is $99/yr before any code ships; TIDAL developer access is free and the Player SDK is covered by Tidal's 30-day trial for the testing window. TIDAL's API shape (OAuth 2.1 + Player SDK + catalog metadata) is the closest substitute for MusicKit JS, so the Phase-1 skeleton ports cleanly. Apple Music demoted to v2 parallel premium tier (was Tidal's old slot). PRD §1–§8 rewritten; native-client vision pushed from v2 to v3+. |
| 2026-05-20 | Phase 0, Phase 1 | R2 dropped; library snapshot reconstructed from D1 rows | R2 was an optimization, not a need — D1 already holds library rows after Phase 1's sync, and rebuilding the library blob from `SELECT * FROM library_songs WHERE user_id=?` is cheap at v1 sizes. Dropping R2 avoids the Cloudflare R2-enable flow (payment method required) and removes a service surface. If cold-start taste-profile builds become slow with real data, revisit. |
| 2026-05-21 | Phase 1 | Phase 1 split into 1a–1d sub-phases (1a shipped) | Phase 1's session budget was 1–2 and flagged as "most likely to spill". Sub-phases are horizontal layers (foundation → auth → sync → UI), not vertical slices — a deliberate exception to §Strategy because the alternative was a single phase that risked context exhaustion mid-implementation. Each sub-phase leaves the worker deployable; user-visible value lands at 1d. |
| 2026-05-21 | Phase 1b | Added `user.read` scope beyond the 1a note's "collection read + write" | Callback needs `GET /v2/users/me` to obtain the TIDAL user id before writing the D1 `users` row. Alternatives (decode access-token JWT, defer user creation to 1c) traded portal-config friction for schema-FK or token-format fragility. One extra round-trip per login is the smallest cost. |
| 2026-05-21 | Phase 1c | Used `/userCollectionTracks/me/relationships/items` (current spec) instead of the deprecated `/userCollections/{id}/relationships/tracks` | The OAS marks the latter deprecated and points to the former. The `me` literal resolves to the authenticated user, eliminating a `/users/me` round-trip on every sync. |
| 2026-05-21 | Phase 1c | Album + album-art left NULL during sync | Pulling them would require `include=items.albums` and album-cover-art lookups, doubling the JSON:API surface. Phase 2 fetches catalog metadata on-demand when rendering recommendation cards, so the data is needed lazily, not eagerly. Revisit if Phase 4's taste-profile builder needs album signals. |
| 2026-05-22 | Phase 1d | Vite pinned to v7, `@vitejs/plugin-react` to v5 | Vitest 3.2.x — already in the repo from Phase 1a — has a vite dep ceiling of `^7.0.0-0`. Vite 8 would have required vitest 4, which re-opens the Workers-test surface for no real benefit. Pinning is cheap and reversible. |
| 2026-05-22 | Phase 1d | Tiny custom router instead of `react-router-dom` | Three routes don't justify a dep. `lib/router.tsx` is ~30 lines and respects modifier-clicks. Revisit if the route count grows past ~5 or if nested routing is needed. |
| 2026-05-22 | Phase 1d | SPA fallback wired via Hono `notFound` + `env.ASSETS.fetch`, not `not_found_handling` alone | Empirically, `not_found_handling: "single-page-application"` does NOT intercept ahead of a `main` Worker — the Worker is consulted first and Hono's 404 wins. The portable fix is to make Hono explicitly proxy non-`/api` 404s to `env.ASSETS.fetch`. `not_found_handling` is what makes that fetch resolve to `/index.html`. Future Workers Assets versions may change this; revisit if the assets/worker precedence becomes configurable. |
| 2026-05-22 | Phase 1d | Vite source `index.html` at `musicbot/index.html`, `public/` is build output | Vite expects entry HTML at its `root`. `publicDir: false` keeps Vite from also treating the output dir as a static-asset source. Net effect matches the BUILDPLAN intent: built `public/index.html` mounts React. |
| 2026-05-25 | Phase 1d | Dropped `not_found_handling: "single-page-application"` from `wrangler.jsonc` (supersedes the 2026-05-22 entry on the same topic) | Earlier same-week reasoning was wrong. When `Sec-Fetch-Mode: navigate` is set (i.e., any browser top-level navigation), Workers Assets's SPA fallback intercepts *ahead* of the Worker — so navigating to `/api/auth/login` returned `/index.html` instead of the OAuth redirect, breaking Connect TIDAL. Fix: drop the flag; the Hono `notFound` catch-all explicitly fetches `/index.html` via `env.ASSETS.fetch` for non-`/api` paths. Caught during the first manual end-to-end smoke after 1d shipped. |
| 2026-05-25 | Phase 5 | Library tab grew from "rec history only" to "TIDAL library browse + history" | User wants to find songs to play directly in the app, not just review past recs. The browse view sits on top of Phase 1c's synced `library_songs` rows and reuses Phase 3's `play` helper + Phase 2's catalog-lookup helper for album-art enrichment — no new dependencies. Session budget bumped 1 → 1–2. Aligns with PRD §3's "users listen *inside* our app" soft goal as a taste-signal capture surface. |
| 2026-05-25 | Phase 2 | Single-shot chat, not multi-turn | Confirmed with PRD owner. Each `/api/chat` sends only the library summary + the current prompt; the thread is client-side React state, unpersisted. Matches the Phase 2 done-when and keeps the API contract small; recommendation history/persistence is where Phase 4/5 already put it. Revisit if follow-up prompts ("more upbeat than those") become a felt need. |
| 2026-05-25 | Phase 2 | Default model `gemini-2.5-flash` | Cloudflare's own AI Gateway example model; fast, cheap, free-tier friendly. Kept as a one-line `GEMINI_MODEL` constant in `llm.ts` so swapping is trivial. |
| 2026-05-25 | Phase 2 | Catalog lookup added to `tidal.ts` (`searchTrack`), beyond the §Phase-2 file list | The done-when requires album art "via TIDAL catalog lookup", and Phase 5 already references "Phase 2's catalog-lookup helper". Resolving each LLM rec against `/searchResults` also yields the canonical TIDAL track id Phase 3 needs to play/add — so the lookup does double duty. Capped at 5 recs (≤ ~7 subrequests) and degrades to no-art on any miss rather than failing the chat. |
| 2026-05-26 | PRD §3, DESIGN §3, Phase 3.5 | Reversed the "minimal player / not a music client / signal-only" stance — in-app playback promoted to a **first-class, client-grade** v1 feature | Owner overrode the PRD: enjoying music directly in the app matters, not just capturing signal. Phase 3.5 expanded to play/pause/skip/scrubber + queue (from recs) + repeat/shuffle; audio persists across in-app tab/route changes by mounting the player at the app root, surfaced in a **persistent mini-player bar** that stays visible across tabs/routes. Sequencing unchanged — Phase 4 (taste profile / week-4 demo feature) still goes first, 3.5 follows. Catalog/search browsing stays out of scope: we build a player, not a Tidal replacement. PRD §3 + DESIGN §3 rewritten; Phase 3.5 session budget bumped 1–2 → 2–3. |
| 2026-05-26 | Phase 3, Phase 3.5 | Real Player SDK split out of Phase 3 into a new **Phase 3.5**; Phase 3 ships Play as a "Listen on TIDAL" deep link | The Player SDK is PRD §7's flagged biggest risk, needs a new dependency (`@tidal-music/player`) + an active subscription, and bundling it into the feedback phase would balloon a tidy 1-session slice. Phase 4's taste profile depends on the *feedback events*, not playback. Confirmed with the owner that in-app playback stays in v1. The deep link is functional now (no dead demo button), brand-compliant (DESIGN §1), and `tidalTrackUrl` is a one-line swap for the SDK later. Phase 5's "Player SDK" references repointed at 3.5. |
| 2026-05-26 | Phase 3 | Add-to-library verified live: `POST /userCollectionTracks/me/relationships/items` *does* support track writes | Pre-implementation the GitHub discussion #90 suggested only albums/artists/playlists were writable. Checking the current `tidal-api-oas.json` showed POST + DELETE on the tracks-items relationship, so the discussion is stale. Endpoint + JSON:API body recorded in the Phase 3 notes. POST-against-`me` (vs a real collection id) is the one piece still unconfirmed live. |
| 2026-05-26 | Phase 3 | `feedback_events` is an append-only log; like/dislike post only on activation | Simplest shape for Phase 4's aggregation (latest-signal-per-song) and matches "events written" in the done-when. No "unlike" event — toggle-off is visual-only. `add` writes only after the TIDAL add succeeds (a recorded `add` implies the library write happened). |
| 2026-05-26 | Phase 4 | `searchTrack` hardening deferred — Phase 4 built first | The 2026-05-26 gut-check had agreed to harden catalog resolution *before* Phase 4 (dead cards starve the feedback signal). Owner chose to build Phase 4 first anyway. Risk accepted: some good recs still render as dead cards (no art, actions disabled) and contribute no `feedback_events` until `searchTrack` is fixed. Still the next task after Phase 4 deploys. |
| 2026-05-26 | Phase 4 | `feedback_events` gained `title`/`artist` columns (beyond the listed 4 files) | The phase's file list assumed `feedback_events` (song_id + kind) was enough. It isn't: the profile must name liked/disliked *artists* for the LLM to act on, and recs aren't in `library_songs` to join against. Added nullable `title`/`artist` and threaded them through the feedback route + client (the card already passed the rec to `onAction`). Confirmed with owner before implementing. Forces a one-time remote `ALTER TABLE`. |
| 2026-05-26 | Phase 4 | Taste profile is derived on demand + snapshotted at chat time, not materialized per event | Recomputing from the append-only log on each `/api/chat` keeps the profile trivially current ("updates after every feedback event") with no write amplification on the feedback path. The `taste_profile_snapshots` row written per chat is what powers the before/after demo. |
| 2026-05-26 | Phase 4 | Profile is artist/track-level only — no genres/eras | The plan text said "favored genres, artists, eras". D1 only holds title+artist (album/genre/era enrichment was deferred 2026-05-21), so genres/eras can't be derived without per-track catalog lookups. Built what the data supports rather than faking signals; revisit if/when album/genre land. |
| 2026-05-26 | Phase 2 | Malformed-LLM-response handling deferred | `generateRecommendations` does `JSON.parse(text)` with no guard. If Gemini ever returns non-JSON despite `responseSchema` (e.g. fenced code, a prose apology), the parse throws and `POST /api/chat` 500s with no guidance to the user. The LLM call is load-bearing so we can't fabricate recs, but we should catch the parse failure and return a structured, user-facing error (mirroring the `no_api_key` path) instead of a raw 500. Low likelihood with `responseSchema` on `gemini-2.5-flash`, so deferred — pick up when chat error UX is revisited (Phase 6 polish or sooner). |

---

## Handoff notes

The project is "done" when:

- Public URL deployed and linked from README.
- All three PRD §4 must-haves have green tests (NL recs, taste learning, card actions).
- Architecture diagram regenerated and committed.
- Demo video + PRD video linked from README.
- Developer can answer unscripted questions about every part of the code (PRD §7 second-biggest risk).
