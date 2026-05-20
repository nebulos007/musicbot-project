# Build Plan

> **Status:** Draft
> **Last updated:** 2026-05-20
> **Current phase:** Phase 0 (scaffolding mostly done — finalizing)

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

**Goal:** A user signs in with Tidal, the app fetches and stores their library, and the chat screen shows recommendation cards (placeholder content) plus a "Loaded N songs" message. Maps to PRD §8 week-2 milestone.

**Context to load:** PRD §4 stories 1+3, §6, §7 (TIDAL Web API + Player SDK limits), §8 week-2; DESIGN §2 (IA, hero screen — *use the static "Loaded N songs" fallback, not the animation*), §3, §4, §5; `CLAUDE.md`; existing `musicbot/` files.

**Files this phase creates/modifies:**
- `musicbot/wrangler.jsonc` — finalize bindings
- `musicbot/src/index.ts` — Hono router (or fetch handler) with `/api/*` + asset fall-through
- `musicbot/src/routes/auth.ts` — TIDAL OAuth 2.1 flow (authorization code + PKCE), session creation, access/refresh tokens stored in KV
- `musicbot/src/routes/library.ts` — paginated library sync (page size + 429 backoff TBD from Phase-1 discovery), writes library rows to D1
- `musicbot/src/db/schema.sql` — `users`, `library_songs`, `sessions` tables
- `musicbot/public/index.html` — React entry
- `musicbot/src/client/App.tsx` — top-level routes (`/login`, `/`, `/settings`)
- `musicbot/src/client/pages/Login.tsx` — "Connect Tidal" button
- `musicbot/src/client/pages/Chat.tsx` — Headless UI `TabGroup` (Chat / Library), gear → `/settings`, chat input, cards list, "Loaded N songs" header
- `musicbot/src/client/components/RecommendationCard.tsx` — album art + title/artist + 4 placeholder buttons
- `musicbot/src/client/lib/tidal.ts` — TIDAL Web API + Player SDK wrapper
- Tailwind + Headless UI + Heroicons + Fraunces font setup
- `README.md` — TIDAL developer-account setup notes

**Tests this phase adds:**
- `auth.spec.ts` — OAuth callback exchanges code for tokens; PKCE verifier round-trips
- `library.spec.ts` — library sync stores songs in D1, paginates, retries on 429
- `RecommendationCard.spec.tsx` — renders title, artist, art, 4 buttons; passes a11y check

**Done-when:**
- [ ] `/login` → "Connect Tidal" → TIDAL OAuth → lands on `/`.
- [ ] Library fetched (paginated) and persisted to D1.
- [ ] `/` shows tabbed Chat/Library, gear → `/settings`, "Loaded N songs" line.
- [ ] At least 3 placeholder cards render (e.g., "first 3 artists from your library").
- [ ] `npm test` passes; `wrangler deploy` ships a working public URL.

**Session budget:** 1–2 (chunky — most likely to spill).

**Risks / unknowns:** TIDAL OAuth 2.1 + PKCE on a Workers backend; refresh-token rotation semantics; Player SDK initialization in-browser; React build pipeline on Workers/Pages; first encounter with the "TIDAL platform is newer / less documented" risk from PRD §7.

---

### Phase 2 — Talk to it, get real recommendations

**Goal:** User enters a natural-language prompt; the app calls their BYOK LLM with library context and replaces placeholder cards with real recommendations. Maps to first half of PRD §8 week-3 milestone.

**Context to load:** PRD §4 story 1, §6 (AI Gateway, BYOK); DESIGN §3 (chat bubble — *no streaming yet*), §6 (chat width on desktop); `CLAUDE.md`; Phase 1 files.

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

**Context to load:** PRD §4 stories 2+3; DESIGN §3 (card), §5 (a11y — color + icon, 44px tap targets); Phase 1+2 files.

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

**Context to load:** PRD §3 (success criteria), §4 story 2, §7 (cold-start risk); DESIGN §3; Phase 1–3 files.

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

**Context to load:** PRD §4 story 4; DESIGN §2 (Library tab), §6 (1/2/3-col grid); Phase 1+3 files.

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

---

## Handoff notes

The project is "done" when:

- Public URL deployed and linked from README.
- All three PRD §4 must-haves have green tests (NL recs, taste learning, card actions).
- Architecture diagram regenerated and committed.
- Demo video + PRD video linked from README.
- Developer can answer unscripted questions about every part of the code (PRD §7 second-biggest risk).
