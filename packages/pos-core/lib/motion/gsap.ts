'use client';

// Central GSAP entry point for the app.
//
// We import the core `gsap` engine and the React `useGSAP` hook here, register
// `useGSAP` as a plugin exactly once (registration is idempotent — GSAP guards
// against double-registration internally, and importing this module is a
// no-op-after-first thanks to ES module caching), then re-export both so every
// motion hook pulls from a single source.
//
// NOTE: keep this file out of the POS first-paint path. It is imported by the
// reusable motion hooks, which later waves attach per-screen. `use-count-up`
// deliberately lazy-imports gsap instead of going through this module so the
// dashboard-only count-up tween never lands in the POS chunk.

import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';

// Idempotent: safe under React 19 strict-mode double-invoke and HMR.
gsap.registerPlugin(useGSAP);

export { gsap, useGSAP };
