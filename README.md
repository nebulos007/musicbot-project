# AI Foundations — Starter Repo

This is the starter repository for **AI Foundations: Architecting the Next Generation of Apps**. Clone it, rename it, and make it yours.

[![Fork this template](https://img.shields.io/badge/Fork_this_template-24292e?style=for-the-badge&logo=github&logoColor=white)](https://github.com/Bumbolio/agentic-coding-starter/fork)
[![View syllabus](https://img.shields.io/badge/View_syllabus-a8361a?style=for-the-badge)](https://bumbolio.github.io/agentic-coding-starter/)

## About this project — musicbot

A Cloudflare-hosted web app that lets TIDAL users have a natural-language conversation with their library to discover new music, learning their taste from explicit feedback over time. Full spec in [`docs/PRD.md`](docs/PRD.md); phased build plan in [`docs/BUILDPLAN.md`](docs/BUILDPLAN.md).

🔗 **Live site:** https://musicbot.musicbot-cs.workers.dev/

### Bring your own key (BYOK)

The app does not ship with a managed LLM. Each user pastes their own Google AI Studio API key in `/settings`; the key is stored in Cloudflare KV (per-user) and proxied through Cloudflare AI Gateway. No charges flow through the developer's account. Free Google AI Studio tier is sufficient for the demo.

### TIDAL developer-account setup

Phase 1 needs TIDAL API credentials. One-time setup before running `wrangler dev`:

1. Sign in to [TIDAL Developer Portal](https://developer.tidal.com/) with a Tidal account that has an active subscription (a fresh 30-day free trial works fine for the v1 build window).
2. Go to **Dashboard → Create app**. Set the redirect URI to `http://localhost:8787/api/auth/callback` for local dev (add a production URI later when deploying).
3. Copy the **Client ID** and **Client Secret** into a local `musicbot/.dev.vars` (copy from [`musicbot/.dev.vars.example`](musicbot/.dev.vars.example) — gitignored).
4. For production, push the same values as Wrangler secrets:
   ```
   wrangler secret put TIDAL_CLIENT_ID
   wrangler secret put TIDAL_CLIENT_SECRET
   ```

### Cloudflare resources

D1 and KV are already created and wired into `musicbot/wrangler.jsonc`. The AI Gateway slug in `vars.AI_GATEWAY_BASE_URL` is `REPLACE_ME` — create a gateway in **Cloudflare Dashboard → AI → AI Gateway** and paste the slug into the URL before deploying Phase 2.

## What's in here

```
.
├── .claude/
│   ├── settings.json                  # Hooks config (Stop hook = run tests after each turn)
│   └── skills/
│       ├── pm-interview/              # Have Claude interview you to produce a PRD
│       ├── design-brief/              # Have Claude interview you to produce a design brief
│       ├── build-plan/                # Slice the project into phases that fit one session each
│       ├── rubber-duck-quiz/          # Quiz yourself on code before committing
│       ├── explain-this-code/         # Have Claude teach you code at the right depth
│       ├── architecture-diagram/      # Generate + critique Mermaid diagrams
│       └── cloudflare-product-picker/ # Pick the right CF product for a need
├── CLAUDE.md                          # Project context Claude reads on every session
├── README.md                          # This file
└── docs/
    ├── PRD.md                         # Template for your Product Requirements Document
    ├── DESIGN.md                      # Template for your UI/UX design brief
    ├── BUILDPLAN.md                   # Template for your phased, context-window-sized build plan
    └── index.html                     # The course syllabus (served via GitHub Pages)
```

## Getting started

1. **Fork this repo** (use the badge above) and clone your fork. Rename the directory to match your project.
2. **Install Claude Code** if you haven't. See [the docs](https://docs.claude.com/en/docs/claude-code/overview).
3. **Install Wrangler:** `npm install -g wrangler`, then `wrangler login`.
4. **Open Claude Code in the project directory:** `claude`.
5. **Run the PM interview** to produce your PRD. It writes directly into `docs/PRD.md`:
   ```
   > Use the pm-interview skill to help me write a PRD for [your idea]
   ```
6. **Run the design-brief interview** once the PRD is stable. Output goes to `docs/DESIGN.md`:
   ```
   > Use the design-brief skill to help me fill out docs/DESIGN.md
   ```
   Defaults are React + Headless UI + Tailwind. The brief captures any deviation.
7. **Bootstrap your app** with `npm create cloudflare@latest` once the PRD and design brief are clear enough.
8. **Run the build-plan interview** after bootstrapping, before writing real features. Output goes to `docs/BUILDPLAN.md`:
   ```
   > Use the build-plan skill to help me fill out docs/BUILDPLAN.md
   ```
   Output is 3–6 phases sized to fit one Claude Code session each. Re-run it when the plan drifts from reality.

## The skills

Use them like this:

| When you're... | Use the skill... |
|---|---|
| Starting a new project or feature | `pm-interview` |
| About to build UI for the first time | `design-brief` |
| About to start coding a project | `build-plan` |
| About to commit a chunk of AI-written code | `rubber-duck-quiz` |
| Staring at code you don't fully grasp | `explain-this-code` |
| Planning architecture or reviewing your own | `architecture-diagram` |
| Unsure which Cloudflare product to use | `cloudflare-product-picker` |

You don't have to name the skill — Claude will pick it up from context. But saying "use the rubber-duck-quiz skill" forces it.

## Hooks

`.claude/settings.json` ships with a **Stop hook** that runs `npm test` whenever Claude finishes a turn — Claude sees failures and keeps working. This enforces TDD without per-edit noise.

If you want stricter behavior, swap the Stop hook for a `PostToolUse` hook (runs after every edit). Edit `.claude/settings.json` and ask Claude — the `update-config` skill knows the format.

## Course rules

- **No `--dangerously-skip-permissions` until week 3.** Read every diff.
- **Run `rubber-duck-quiz` before every meaningful commit.** Claude can draft the commit message and run `git commit` for you — that's encouraged. The rule is that you must understand the change well enough to defend it before it lands.
- **Architecture diagrams get regenerated every week.** If it no longer matches the code, something drifted.
- **Two videos required, both linked in this README:**
  - A **PRD explainer video** (≤5 min) recorded after week 1.
  - A **demo video** (≤5 min) recorded by week 4 — the deployed app plus 2–3 file-level decisions.

## Your project links

_Replace these once you deploy and record:_

🔗 **Live site:** [https://musicbot.musicbot-cs.workers.dev/](https://your-project.pages.dev)
🎥 **PRD video:** [your-prd-video-link]
🎥 **Demo video:** [your-demo-video-link]
