# Design: Thai / English i18n with in-app language switcher

**Date:** 2026-06-12
**Status:** Approved (Phase 1 in progress)

## Goal

The app is a Thai café POS whose UI is currently a **mix** of hardcoded Thai and English
strings. We want:

1. A consistent **Thai base** for the whole product (default language).
2. A full **English** version.
3. A **language switch in Settings** that toggles the whole app between ไทย / English,
   persisted across sessions.

Brand / technical terms (POS, KDS, BOM, SOP, QR, LINE, PromptPay) stay English in **both**
languages. English copy is authored by the implementer.

## Approach

**Lightweight custom React Context** (no new dependency). Chosen over `next-intl`
(requires locale-segment routing this single-page app doesn't have) and `react-i18next`
(extra dep + ICU machinery we don't need).

The app is a single page (`app/src/app/page.tsx`) that swaps screens by state — there is no
routing — so a context + dictionary is the natural fit. Screens that aren't migrated yet keep
their hardcoded Thai and simply don't react to the toggle, so the rollout is safe and
incremental.

### Architecture

```
app/src/lib/i18n/
  th.ts      # Thai dictionary — source of truth. Exports `th` and `type Messages = typeof th`.
  en.ts      # English dictionary, typed `: Messages` so missing/extra keys are TS errors.
  index.tsx  # LanguageProvider + useI18n(); persists choice to localStorage('kafe-lang').
```

- `useI18n()` returns `{ t, lang, setLang }`.
  - `t` is the **resolved dictionary object** for the current language → fully type-safe
    member access (`t.nav.pos`, `t.common.save`), no string-key lookups.
  - Strings needing interpolation are **functions**: `t.shoppingList.removed(name)`.
- Default language `th`. On mount, read saved preference from `localStorage` (effect, not
  state initializer, to avoid SSR hydration mismatch). `setLang` writes localStorage and
  syncs `document.documentElement.lang`.
- Provider mounted in `app/src/app/providers.tsx` so it wraps login + the whole app.

### Navigation labels

`NAV`, `MAIN_TABS`, `MORE_ITEMS` in `app-common.tsx` keep their structural metadata
(id, icon, flags) but **drop hardcoded `label`**; the display label is resolved at render via
`t.nav[id]` / `t.tabs[id]` (fallback to id). `ROLE_LABEL` → `t.roles[role]`.

### Settings screen

Replace the `Settings` placeholder with a real `screens/settings.tsx`. Phase 1 content:
a prominent **Language** card with a ไทย / English segmented control wired to `setLang`,
plus translated "coming soon" info cards (store info, devices, integration, backup).

## Scope

**Phase 1 (this work):**
- i18n core + provider wiring.
- Sidebar + BottomTabBar nav, roles, aria labels.
- Real Settings screen with the language toggle.
- Core daily screens: POS, KDS, Dashboard, Shopping List, Members.

**Later phases:** remaining ~20 screens, migrated in batches. Until migrated they render Thai
in both modes (acceptable — Thai is the base).

## Out of scope

- Translating backend-provided data (product names, member names, notes).
- Per-screen / per-URL locale. Language is a single app-wide preference.
- RTL. Both languages are LTR.

## Testing

- `tsc --noEmit` must pass (en parity enforced by the `Messages` type).
- Manual: toggle in Settings flips nav + the 5 core screens + Settings; reload preserves choice;
  Thai mode unchanged for un-migrated screens.
