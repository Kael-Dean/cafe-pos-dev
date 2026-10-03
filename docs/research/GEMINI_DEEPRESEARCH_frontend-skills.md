# Deep Research Prompt — Frontend Team Skill Upgrade (paste into Gemini Deep Research)

> วิธีใช้: copy ทั้งหมดใต้เส้นไปวางใน Gemini Deep Research. รันทีเดียวได้ หรือแยกรันทีละ TRACK ถ้าอยากได้ลึกขึ้น. เสร็จแล้วเอา output กลับมาให้ Claude (`skill-creator`) แปลงเป็น skill.

---

## ROLE & GOAL

You are a senior frontend research analyst. I run a **web agency in Thailand** that builds:
- **POS / KDS / inventory / reporting web apps** (data-dense, used for hours, touch tablets, thermal receipt printing, often flaky in-store WiFi), and
- **client marketing sites + storefronts** (landing pages, e-commerce).

Stack: **Next.js (App Router) + React + TypeScript + Tailwind + shadcn/ui**, deployed on Vercel. Animation with GSAP / Framer Motion.

I direct AI coding agents (Claude Code) to build these. I already have strong general skills for: performance, Core Web Vitals, accessibility/WCAG, SEO, CRO, copywriting, UI/UX systems. **Do NOT re-explain the basics of those.**

Your job: research the **gaps below** and return **implementation-ready knowledge** I can compile into reusable AI-agent "skills" — meaning concrete rules, checklists, decision tables, code patterns, and named pitfalls — NOT generic blog-level overviews.

## OUTPUT FORMAT (apply to every track)

For each track produce:
1. **Core principles** (5–10 bullets, opinionated, current as of 2025–2026).
2. **Decision table / rules** — when to do X vs Y, with the trigger condition.
3. **Concrete patterns** — minimal code snippets in the stack above (Next.js/React/TS/Tailwind), or config.
4. **Anti-patterns & pitfalls** — what AI agents commonly get wrong here, and the correct fix.
5. **"Definition of Done" checklist** — testable items I can paste as acceptance criteria.
6. **Sources** — cite primary docs, specs, and reputable 2024–2026 references. Flag anything that changed recently or is contested.

Prioritize **accuracy and recency**. If something is version-specific (Next.js 15+, React 19, Tailwind v4), say so.

---

## TRACK 1 — Resilience for poor / intermittent networks (offline-tolerant web apps)

Context: in-store WiFi drops mid-shift; orders must not be lost.
Research:
- Offline-first architecture for a React/Next.js PWA: Service Worker strategies (Workbox), cache strategies per resource type, app-shell.
- **Mutation queue while offline** — capturing writes (new orders, edits), persisting to IndexedDB, replaying on reconnect; libraries vs hand-rolled.
- **Sync conflict resolution** — last-write-wins vs CRDT vs server-authoritative; when each is appropriate for POS-style data.
- Optimistic UI done correctly: rollback on failure, idempotency keys to avoid double-submit on retry.
- Reconnect & retry: exponential backoff + jitter, online/offline detection beyond `navigator.onLine`, request deduplication.
- Detecting slow connection (Network Information API / effectiveType) and degrading gracefully (lower-res images, defer non-critical fetch).
- Background Sync API support/limits in 2026; fallbacks for iOS Safari.

## TRACK 2 — Thai-specific frontend (i18n, fonts, formats, regulation)

Research, specifically for Thai language and Thai market:
- **Thai typography on web**: word-break / line-break behavior (Thai has no spaces between words), `word-break`, `line-break: loose/strict/auto`, `overflow-wrap`, the `lang="th"` attribute's effect, browser ICU support, libraries for Thai word segmentation (e.g. ICU `Intl.Segmenter`, thai-word-breaking). Recommended Thai webfonts (Sarabun, Noto Sans Thai, IBM Plex Sans Thai), subsetting, FOUT/FOIT handling, font loading performance for Thai glyph sets.
- **Formatting**: THB currency, Thai/Buddhist calendar (พ.ศ.), date/number via `Intl` with `th-TH-u-ca-buddhist`, Thai numerals.
- **Payments**: PromptPay QR generation/standards (EMVCo), displaying QR for payment, common Thai payment gateways (Omise, 2C2P, GBPrimePay) frontend integration patterns.
- **LINE ecosystem**: LINE Login, LIFF apps, LINE share/OG behavior, LINE's in-app browser quirks that break web apps.
- **PDPA (Thailand)**: what a compliant web app needs on the frontend — consent UI, cookie consent, data subject rights surfaces; how it differs from GDPR in practice.
- **Mobile reality in Thailand**: device/network mix, data-cost sensitivity, common low-end Android quirks.

## TRACK 3 — POS / data-dense operational UI craft

Research patterns specific to high-volume operational interfaces:
- Touch-first design for tablets: hit-target sizing, fast tap, avoiding hover-dependent UI, gloved/wet-hand use, glare/brightness.
- High-throughput data entry: keyboard + numeric pad UX, scan-to-add (barcode/QR via camera or HID scanner), minimizing taps per transaction.
- **Real-time order/KDS updates**: WebSocket vs SSE vs polling — decision criteria, reconnection, missed-message recovery, optimistic vs server-confirmed state.
- Large lists / virtualized tables performance (TanStack Virtual), sort/filter at scale without jank.
- Thermal receipt printing from web: ESC/POS basics, browser limitations, bridge/agent pattern, print preview fidelity.
- Preventing operator error: confirmation patterns for destructive POS actions, undo windows, double-charge prevention.
- Session/shift state, multi-device same-store consistency.

## TRACK 4 — Distinctive UI that doesn't look "AI-generic"

Context: AI agents default to generic shadcn-looking layouts. I want craft that signals premium.
Research:
- What concretely makes UI read as "generic AI output" vs bespoke (spacing rhythm, type scale, color use, border/shadow choices, default component tells) — with before/after examples.
- Building a real design-token layer (primitive → semantic → component) on Tailwind v4 + shadcn so brand identity is systematic, not ad-hoc.
- Motion that elevates without gimmick: micro-interactions, choreography/staging, easing curves, when to use GSAP vs Framer Motion vs CSS, respecting `prefers-reduced-motion`.
- Current (2025–2026) visual direction references that age well vs trends that look dated fast.
- Editorial/layout techniques: asymmetry, grid breaking, expressive type — applied without hurting usability.

## TRACK 5 — Frontend security & privacy beyond the basics

Skip XSS/CSRF/HTTPS basics. Research:
- **CSP** for a Next.js App Router app: nonce-based CSP with the framework, what breaks, reporting, strict-dynamic.
- Securing client-side auth: token storage (cookie vs memory vs storage), httpOnly + SameSite patterns, refresh rotation, defending against token theft.
- Supply-chain risk on the frontend: dependency auditing, lockfile hygiene, subresource integrity, npm/pnpm safety, malicious package detection.
- Protecting against UI-layer attacks: clickjacking, tabnabbing, open-redirect, prototype pollution in client code.
- Secrets hygiene in Next.js: `NEXT_PUBLIC_` footguns, what leaks into the client bundle, server actions/route handlers boundary.
- Privacy-respecting analytics and third-party script governance.

## TRACK 6 — Production resilience & observability (frontend)

Research:
- Error boundaries that don't white-screen the whole app; per-region fallback UI; recovery.
- Frontend monitoring: Sentry (or alternatives) setup for Next.js — source maps, release tracking, RUM for Web Vitals, session replay tradeoffs/privacy.
- Feature flags & safe rollout on the frontend (gradual rollout, kill switch).
- Handling API failure states as first-class UX: the loading/error/empty/partial matrix, retry affordances, stale-while-revalidate messaging.
- Client-side performance budgets and how to enforce them in CI (Lighthouse CI, bundle-size gates).

## TRACK 7 — Directing AI agents to build frontend well (meta-skill)

Context: I orchestrate Claude Code agents. Research how to get the best frontend output from coding agents:
- How to write a frontend spec / Definition of Done that LLM agents execute reliably (what level of detail, what to pin vs leave open).
- Effective prompt/structure patterns for: building a component, refactoring UI, fixing a11y, optimizing performance — including what context to provide (design tokens, examples, constraints).
- Common failure modes of AI-generated frontend (over-abstraction, inconsistent spacing, ignoring states, inaccessible markup, hallucinated APIs) and guardrails that prevent them.
- How to structure a reusable component/design-system so agents stay consistent across many client projects.
- Review checklist a human lead should run on agent-produced frontend before shipping to a client.

---

## FINAL SYNTHESIS (after all tracks)

End with a **prioritized table**: `topic | impact on my work (high/med/low) | effort to adopt | which existing skill it complements or which new skill to create`. Recommend which 3 tracks would most improve a Thai POS-focused agency's frontend output first.
