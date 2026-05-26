# Design Brief

_This file is the source of truth for UI/UX decisions on this project. Fill it out with the `design-brief` skill after the PRD is solid. Keep it short — a design brief is a compass, not a spec._

## 1. Visual identity

**Mood (3–5 adjectives):** Warm, conversational, tactile, music-first.

- _Warm / conversational_ — the chat is the main interaction; it should feel like texting a friend with great taste, not querying a search engine.
- _Tactile_ — buttons (like / dislike / add-to-library) acknowledge the press with motion and weight. The app feels alive when you act on it.
- _Music-first_ — album art and song titles carry the visual weight. Chrome stays quiet so the content is loud. Reinforced by the dark-only palette (see §4) — album art glows against a dim, warm-stone background like a record sleeve under a single light.

**Reference apps:**

- **Apple Music** — for album-art-forward layout. Artwork is the hero; chrome stays out of the way. (Visual reference only — v1 ships against Tidal; see PRD §3.)
- **Tidal** — the v1 platform. Its dark, album-art-forward presentation is closely aligned with what we want for visual continuity when users hop between apps.
- **iMessage** — for chat rhythm. Bubble pacing, the way a reply streams in, send-button feedback, the feeling that the other side is "thinking."

**Anti-references:**

- **Facebook** — looks cheap. Cluttered, ad-driven, low-trust visual quality. This app should feel like something a music enthusiast would actually want to open.

**Brand constraints:** Stay inside TIDAL's developer / brand guidelines. (Look up the current version on the TIDAL Developer Portal before launch — the rules below are the conservative defaults; tighten or relax once we've read the official guide.)

Practical implications:
- **Don't use TIDAL marks** (the TIDAL wordmark, logo, gradient) as our own branding.
- **Don't impersonate TIDAL's UI.** Reference its album-art-forward feel, but the app should not look like a reskin of TIDAL — it's a companion, not a clone.
- **Don't use "TIDAL" in the app name** in a way that implies endorsement. "[Name] for TIDAL" framing is OK; "TIDAL [Name]" is not.
- **Use the official "Listen on TIDAL" badge / attribution** when linking out, per TIDAL's badge guidelines if one is published; otherwise plain-text "Listen on TIDAL" is safer.
- **Don't use SF Pro** as our brand font — it's licensed only for Apple platforms / Apple-platform apps. Pick a different display/body font (decided in §4).

## 2. Information architecture

**Primary screens (top-level routes):**

- **`/`** — chat / discovery. Two tabs at the top: **Chat** (default — conversation + recommendation cards) and **Library** (past recommendations with ratings, user story #4). Library is a tab, not its own URL.
- **`/settings`** — BYOK API key, Tidal auth, taste profile / avatar view (user story #6 if kept), sign-out. Profile is folded in here for v1 to keep the surface small.
- **`/login`** — landing + auth.

**Navigation model:** No persistent nav chrome. A **gear icon in the top-right** of `/` links to `/settings`. Settings is rarely visited, so it doesn't need a tab bar slot — and skipping the bar gives the chat the full screen on mobile, which fits the "music-first, quiet chrome" mood.

The two **Chat / Library** tabs sit at the top of `/` (a Headless UI `TabGroup`).

**Future:** when the taste-avatar feature (user story #6) lands, swap the gear for a **taste-avatar chip** in the same spot — tapping it still opens settings, but it doubles as a visible hook for the avatar.

**The hero screen:** `/` — the chat.

In 3 seconds it should communicate, in order:

1. **"This knows your library."** — On the first session, after Tidal auth, run a short animation that visibly chews through the user's library (album art tiles flying in, a counter ticking up, genres surfacing). This turns the unavoidable cold-start load into a "the app is doing something for me" moment instead of a spinner.
2. **"Talk to me about music."** — The animation resolves into the chat input with a placeholder like _"What do you want to hear?"_, ready for the first prompt.

On subsequent sessions, skip straight to the chat — the animation is a one-time onboarding moment, not chrome we re-show every time.

## 3. Component approach

- **Framework:** React.
- **Component library:** [Headless UI](https://headlessui.com/) for unstyled, accessible primitives (Dialog, Menu, Combobox, Listbox, Disclosure, TabGroup, Switch).
- **Styling:** Tailwind CSS.
- **Icons:** [Heroicons](https://heroicons.com/) — same team as Tailwind/Headless UI, one less decision.
- **Custom components** (Headless UI doesn't cover):
  - **Recommendation card** — album art, title/artist, action buttons (play / add-to-library / like / dislike). Just a styled `div` with Heroicons + tactile button feedback.
  - **Chat bubble + streaming reply** — message list, user vs. assistant bubbles, streaming-text animation, send button.
  - **Audio player controls** — client-grade: play/pause, skip, scrubber, a queue built from recommendations, repeat/shuffle, surfaced in a **persistent mini-player bar** that stays visible and keeps playing across the Chat/Library tabs and routes (the Spotify / Apple-Music bottom-bar pattern). TIDAL Player SDK provides behavior; we build the visuals. The player **mounts once at the app root**, not inside a tab/route, so audio is never interrupted. Watch the 390px phone case: the mini-player and the Chat tab's bottom-pinned input compete for bottom space — stack or collapse them deliberately (see §6). _(Revised 2026-05-26 — playback is now a first-class feature; see PRD §3.)_
  - **Cold-start library animation** — first-session-only "this knows your library" moment (see §2 hero screen).
  - **Taste-avatar visualization** — deferred (user story #6, "could-have"). Likely SVG/canvas. Out of scope for v1.

**Why this stack:** Headless UI gives accessibility (focus management, ARIA, keyboard nav) for free; Tailwind makes the styling decisions explicit in markup. Together they let an AI-assisted developer move fast without shipping inaccessible junk.

## 4. Visual tokens

Pick a small palette and stick to it. Don't try to design a full design system — pick enough to be consistent.

- **Color:** **Dark-only for v1.** Warm-stone palette (not slate / not pure black) with teal as the only UI color. Album art shines on a dark background — this is why Apple Music, Tidal, and Spotify all default to dark, and it leans into the "music-first, concert-hall" feel.

  | Role | Tailwind | Hex |
  |---|---|---|
  | Primary | `teal-500` | `#14B8A6` |
  | Primary hover | `teal-400` | `#2DD4BF` |
  | Background | `stone-900` | `#1C1917` |
  | Surface (cards, modals) | `stone-800` | `#292524` |
  | Elevated surface | `stone-700` | `#44403C` |
  | Body text | `stone-100` | `#F5F5F4` |
  | Muted text | `stone-400` | `#A8A29E` |
  | Border / divider | `stone-700` | `#44403C` |
  | Success | `emerald-500` | `#10B981` |
  | Warning | `amber-400` | `#FBBF24` |
  | Danger | `red-500` | `#EF4444` |

  **No separate accent color.** Teal is the accent. Anything else colorful on screen is album art.

  **Stone, not slate / zinc.** `stone` has a warm brown undertone — feels like a dim listening room, not a cold OLED. Cool grays would fight the mood.

  **Brighter teal on dark.** `teal-500` (not `teal-700`) — darker teals disappear into the background. Same logic for the semantic colors: bumped up one shade vs. a typical light palette.
- **Type:** Two fonts — system stack for body, a warm serif for display.

  - **Body:** system stack — `ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` (Tailwind's `font-sans` default). Zero load, native feel per OS, sidesteps the no-SF-Pro brand constraint without choosing a Google font.
  - **Display:** [Fraunces](https://fonts.google.com/specimen/Fraunces) (Google Fonts) — a warm, slightly editorial serif. Used for song / album titles in card hero state, screen titles, the cold-start animation. Lets the music feel like *content* (album credits, liner notes), not SaaS.

  **Sizes** (Tailwind defaults are fine):

  | Use | Class | Font |
  |---|---|---|
  | Display / hero song title | `text-3xl` / `text-4xl` | Fraunces |
  | Screen title (h1) | `text-2xl` | Fraunces |
  | Section header (h2) | `text-lg` | system |
  | Body / chat bubble | `text-base` | system |
  | Small / muted | `text-sm` | system |
  | Caption / timestamp | `text-xs` | system |
- **Spacing scale:** Tailwind defaults. No deviation.

- **Radius:** Two values, used consistently.
  - **`rounded-xl`** (~12px) on **cards, buttons, inputs, modals** — friendly, iOS-native, fits the warm/tactile mood.
  - **`rounded-full`** on **chat bubbles only** — directly borrows the iMessage chat rhythm cited in §1.

- **Shadow:** Shadows don't work on dark backgrounds. Use **surface elevation** instead — cards lift via a lighter background (`bg-stone-800` on a `bg-stone-900` page), and modals lift further (`bg-stone-700`). Optionally combine with a 1px `border border-stone-700` for definition. Reserve `shadow-lg` for popovers/menus that overlay other content if a hard edge isn't enough — but most of the time, surface contrast is the elevation.

## 5. Accessibility floor

Non-negotiables:

1. **Keyboard-navigable end-to-end.** Every action (send, like, dislike, add-to-library, switch tabs, open settings) reachable from the keyboard. Headless UI primitives give this for free.
2. **WCAG AA contrast on all text.** `stone-100` on `stone-900` passes (~16:1). `teal-500` on `stone-900` passes for body and large text. `stone-400` is for muted / secondary text only — never body.
3. **Visible labels on form inputs.** No placeholder-as-label. Applies to BYOK key entry and the chat input (which can use a visually-hidden `<label>` if a literal label looks wrong).
4. **Visible focus states.** Never `outline: none` without a replacement. Default ring: `focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-900`.
5. **Color is never the only signal.** Like/dislike use an icon *and* a fill change. "Added to library" uses a check icon, not just a teal background.

**Flagged as needing extra care** (revisit when building):

- **Streaming chat replies** must use an ARIA live region (`aria-live="polite"`) so screen readers announce the assistant's reply as it arrives, instead of staying silent or re-reading the whole thread on every token.
- **Cold-start library animation** must respect `prefers-reduced-motion` — degrade to a static "Loaded N songs from your library" message for users who've opted out of motion. Same for any tactile button animations.

## 6. Responsive strategy

- **Breakpoints:** Tailwind defaults (`sm` 640px, `md` 768px, `lg` 1024px, `xl` 1280px).
- **Smallest target:** **iPhone 12 (390px wide).** iPhone SE (375px) users are not in scope.
- **What changes at each breakpoint:**
  - **Phone (default, < `md`):** Single column. Chat fills the screen. Recommendation cards stack vertically. Chat input pinned to bottom. Chat / Library tabs at top.
  - **Tablet (`md`, ≥ 768px):** Same single-column chat with wider gutters. Library tab switches to a 2-column card grid.
  - **Desktop (`lg`, ≥ 1024px):** Constrain the chat column to a comfortable reading width (~640–720px max), centered. Do not let chat bubbles go full-bleed at wide viewports. Library tab uses a 3-column card grid.

## 7. Risks & unknowns

- **Cold-start library animation.** Highest mood payoff in the brief, but also the most custom piece of motion work in v1. Has to handle libraries of varying sizes (a few hundred to many thousand songs) gracefully, must not block the chat from becoming usable, and must degrade to a static "Loaded N songs" message under `prefers-reduced-motion`. **Mitigation:** ship a static fallback first; treat the animation as a stretch on top. Don't let it eat week 2.
- **Chat-reply streaming feel.** Making it actually feel like iMessage (typing indicator → smooth token streaming → settle) is harder than streaming tokens into a `<div>`. Easy to ship a janky version that undermines the whole "warm, conversational" mood. **Mitigation:** prototype this on day one of week 3 with mock data, before wiring up the real LLM.
- **Recommendation-card density on phone.** The user is phone-primary (PRD §2), but the **week-4 demo runs on a PC** — so this is a real long-term concern, not a demo blocker. Like / dislike / play / add-to-library all need ≥ 44px tap targets on a 390px screen alongside album art and song info, and tuning that is hard without real recommendations on real devices. **Mitigation:** design and tune for desktop first (demo path); reserve a sanity-check pass on a real iPhone in week 4 *after* the demo is locked.

## 8. Out of scope (for v1)

Same spirit as the PRD's out-of-scope section, but for design.

- **Light mode** — dark-only for v1. No theme toggle. Revisit post-launch.
- **Native iOS / Mac app design language** — v2 (per PRD §3, §5). The web app should not be designed as a "preview" of the native app; design for the web, let v2 redesign for native UIKit / SwiftUI when it gets there. Don't reach for iOS-only patterns (sheets, swipe-to-dismiss, tab bar haptics) on the web.
- **Custom illustrations / mascot / logo system** — simple wordmark only.
- **Animations beyond Headless UI defaults + the one cold-start moment** — no parallax, scroll-linked motion, or spring physics on cards.
- **Internationalization** — English only. Don't structure code or layouts around i18n.
- **Themed album art** (color-extracted from cover → tint UI) — looks magical, eats a week. Skip.
- **Taste-avatar visualization** — already a "could-have" in PRD §4. Out of the v1 design surface.
- **In-app onboarding tour / tooltip walkthrough** — the cold-start animation plus a single placeholder in the chat input is enough.
