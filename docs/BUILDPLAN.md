# Build Plan

> **Status:** Draft
> **Last updated:** 2026-05-21
> **Current phase:** Phase 1d (React frontend) — 1c shipped 2026-05-21

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

#### Phase 1d — React frontend

**Goal:** `/login` → "Connect Tidal" → OAuth round-trip → lands on `/` showing tabbed Chat/Library, gear → `/settings`, "Loaded N songs" header, ≥3 placeholder recommendation cards.

**Context to load:** DESIGN §2, §3, §4, §5; PRD §4 stories 1+3; `CLAUDE.md`; Phase 1a–1c files. *Use the static "Loaded N songs" fallback, not the cold-start animation (deferred to Phase 6).*

**Files this phase creates/modifies:**
- `musicbot/vite.config.ts` — Vite build emitting to `public/`
- `musicbot/src/client/main.tsx` — React entry
- `musicbot/src/client/App.tsx` — routes (`/login`, `/`, `/settings`)
- `musicbot/src/client/pages/Login.tsx` — Connect Tidal button
- `musicbot/src/client/pages/Chat.tsx` — Headless UI `TabGroup`, gear → settings, chat input, cards list, "Loaded N songs" header
- `musicbot/src/client/components/RecommendationCard.tsx` — placeholder cards with 4 buttons
- `musicbot/src/client/lib/api.ts` — fetch wrapper using the session cookie
- `musicbot/public/index.html` — replace scaffold with React mount
- `musicbot/wrangler.jsonc` — `assets.not_found_handling: "single-page-application"` for client routing
- Tailwind + Fraunces font + Headless UI + Heroicons setup
- `README.md` — TIDAL developer-account setup notes
- `package.json` — `react`, `react-dom`, `@vitejs/plugin-react`, `vite`, `tailwindcss`, `@headlessui/react`, `@heroicons/react`, type packages (approve as a batch when sub-phase starts)

**Tests this phase adds:**
- `RecommendationCard.spec.tsx` — renders title, artist, art, 4 buttons; basic a11y

**Done-when:**
- [ ] `/login` shows "Connect Tidal".
- [ ] OAuth completes and lands on `/`.
- [ ] `/` shows tabs, gear → `/settings`, "Loaded N songs" line.
- [ ] ≥3 placeholder cards render.
- [ ] `npm test` passes; `wrangler deploy` ships a working public URL.

**Session budget:** 1–2.

**Risks / unknowns:** Vite + Workers Assets integration (build output path, dev workflow); SPA fallback on Workers Assets; Tailwind v4-vs-v3 ergonomics.

---

### Phase 2 — Talk to it, get real recommendations

**Goal:** User enters a natural-language prompt; the app calls their BYOK LLM with library context and replaces placeholder cards with real recommendations. Maps to first half of PRD §8 week-3 milestone.

**Context to load:** PRD §4 story 1, §6 (AI Gateway, BYOK); DESIGN §3 (chat bubble — *no streaming yet*), §6 (chat width on desktop); `CLAUDE.md`; Phase 1a–1d files.

**Files this phase creates/modifies:**
- `musicbot/src/routes/chat.ts` — POST `/api/chat` (prompt → LLM → JSON recs)
- `musicbot/src/lib/llm.ts` — Gemini (Google AI Studio) call via AI Gateway
- `musicbot/src/lib/promptTemplates.ts` — prompt construction with a *summary* of the library (not the whole library)
- `musicbot/src/routes/settings.ts` — KV-backed BYOK key storage
- `musicbot/src/client/pages/Settings.tsx` — visible-label BYOK input + Tidal auth status
- `musicbot/src/client/pages/Chat.tsx` — wire input → `/api/chat` → cards
- `musicbot/src/client/lib/api.ts` — fetch wrapper with session header

**Tests this phase adds:**
- `chat.spec.ts` — given a prompt + mocked LLM, returns structured rec JSON
- `llm.spec.ts` — handles missing key, builds the AI Gateway URL correctly
- `settings.spec.ts` — BYOK round-trip read/write
- `promptTemplates.spec.ts` — library summary stays under a token budget

**Done-when:**
- [ ] User sets a Google AI Studio key in `/settings`.
- [ ] Typing "something like Phoebe Bridgers but more upbeat" updates the cards with real recs (title, artist, album art via TIDAL catalog lookup).
- [ ] Reply lands as a single message — no streaming.
- [ ] Tests pass; deployed.

**Session budget:** 1–2.

**Risks / unknowns:** Prompt quality before any feedback exists (PRD §7 cold-start risk); TIDAL catalog lookup for free-text artist/song names returned by the LLM; AI Gateway BYOK semantics.

---

### Phase 3 — Act on a recommendation

**Goal:** Like / dislike / add-to-library / play buttons on each card all work and write feedback events to D1. Maps to second half of PRD §8 week-3 milestone.

**Context to load:** PRD §4 stories 2+3; DESIGN §3 (card), §5 (a11y — color + icon, 44px tap targets); Phase 1a–1d + Phase 2 files.

**Files this phase creates/modifies:**
- `musicbot/src/db/schema.sql` — add `feedback_events` (`user_id`, `song_id`, `kind`, `created_at`)
- `musicbot/src/routes/feedback.ts` — POST `/api/feedback` for like/dislike/add
- `musicbot/src/lib/tidal.ts` — `addToLibrary`, `play` helpers
- `musicbot/src/client/components/RecommendationCard.tsx` — wire 4 buttons + fill-state change + tactile press feedback (CSS only — respect `prefers-reduced-motion`)
- `musicbot/src/client/lib/api.ts` — feedback POST helpers

**Tests this phase adds:**
- `feedback.spec.ts` — events written with `user_id`, `song_id`, `kind`, timestamp
- `RecommendationCard.spec.tsx` — buttons call correct handlers, fill-state change is a class change (verifiable), 44px target via computed style
- `tidal-add.spec.ts` — `addToLibrary` handles auth refresh + 429

**Done-when:**
- [ ] All four buttons functional, ≥44px on a 390px viewport.
- [ ] Like / dislike change icon **and** fill (not color alone — DESIGN §5).
- [ ] Add-to-library adds the song to the user's Tidal library.
- [ ] Feedback events visible in D1.
- [ ] Tests pass; deployed.

**Session budget:** 1.

**Risks / unknowns:** TIDAL `addToLibrary` scope / errors; tap-target tuning without a real iPhone in hand (DESIGN §7).

---

### Phase 4 — Taste profile that learns

**Goal:** Recommendations measurably differ between session 1 (cold start) and session 5 (after feedback) because the LLM prompt is enriched with a derived taste profile. Maps to PRD §8 week-4 demo milestone.

**Context to load:** PRD §3 (success criteria), §4 story 2, §7 (cold-start risk); DESIGN §3; Phase 1a–1d + Phases 2–3 files.

**Files this phase creates/modifies:**
- `musicbot/src/lib/tasteProfile.ts` — derive a profile from library + feedback (favored genres, artists, eras; recent dislikes as exclusions)
- `musicbot/src/lib/promptTemplates.ts` — inject profile signals
- `musicbot/src/routes/chat.ts` — call `tasteProfile` before LLM
- `musicbot/src/db/schema.sql` — add `taste_profile_snapshots` (for observability + demo)

**Tests this phase adds:**
- `tasteProfile.spec.ts` — sane profile given mock library + mock feedback
- `chat.spec.ts` — prompt includes profile signals
- Integration: simulate 10 likes/dislikes, assert next recs differ from baseline (deterministic via seeded LLM mock)

**Done-when:**
- [ ] Profile updates after every feedback event.
- [ ] LLM prompt visibly carries taste signals (verifiable via AI Gateway log).
- [ ] Recs after 10 feedback events differ from cold-start recs in tests.
- [ ] Demo can show before / after side-by-side.
- [ ] Tests pass; deployed.

**Session budget:** 1–2.

**Risks / unknowns:** Cold-start quality without play counts (PRD §7 — needs to be tested early); over-fitting to a single dislike; profile drift if an event is mis-clicked.

---

### Phase 5 — Library tab (recommendation history)

**Goal:** Users see past recommendations with their ratings in the Library tab. Maps to PRD §4 story #4 (Should-have).

**Context to load:** PRD §4 story 4; DESIGN §2 (Library tab), §6 (1/2/3-col grid); Phase 1a–1d + Phase 3 files.

**Files this phase creates/modifies:**
- `musicbot/src/routes/history.ts` — paginated history (newest first)
- `musicbot/src/client/pages/Chat.tsx` — wire the Library tab
- `musicbot/src/client/components/RecommendationCard.tsx` — read-only "history" variant showing the rating given
- `musicbot/src/client/components/HistoryGrid.tsx` — responsive 1/2/3-col

**Tests this phase adds:**
- `history.spec.ts` — paginated, includes feedback, newest first
- `HistoryGrid.spec.tsx` — column count correct at `md` + `lg`

**Done-when:**
- [ ] Library tab shows past recs newest-first, with the rating the user gave.
- [ ] Responsive: 1 col phone, 2 col tablet, 3 col desktop.
- [ ] Tests pass; deployed.

**Session budget:** 1.

**Risks / unknowns:** low.

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

---

## Handoff notes

The project is "done" when:

- Public URL deployed and linked from README.
- All three PRD §4 must-haves have green tests (NL recs, taste learning, card actions).
- Architecture diagram regenerated and committed.
- Demo video + PRD video linked from README.
- Developer can answer unscripted questions about every part of the code (PRD §7 second-biggest risk).
