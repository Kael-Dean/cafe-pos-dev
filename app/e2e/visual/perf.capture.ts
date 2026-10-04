import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect, type CDPSession, type Page } from '@playwright/test';
import { MockApi } from '../support/mock-api';
import { seedCaptureApi } from './capture-data';

/**
 * TEMPORARY perf probe for the touch-first POS (INP / CLS / prefetch / re-render).
 * Production build, CDP CPU throttle (PERF_THROTTLE, default 4), real motion.
 *
 *   $env:E2E_SKIP_BUILD='1'; $env:E2E_PORT='3191'; $env:E2E_UPSTREAM_PORT='3192'
 *   npx playwright test -c playwright.capture.config.ts e2e/visual/perf.capture.ts --project=tablet-1024x768
 */

const OUT = process.env.PERF_OUT || path.join('test-results', 'perf');
const THROTTLE = Number(process.env.PERF_THROTTLE ?? 4);
const EXTRA_PRODUCTS = Number(process.env.PERF_EXTRA_PRODUCTS ?? 45); // 15 seed + 45 = 60

// ── in-page instrumentation (installed before any app script) ────────────────
function instrument() {
  const w = window as any;
  const P: any = (w.__perf = { events: [], shifts: [], loaf: [], commits: [], feedback: null });

  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as any[]) {
      P.events.push({
        name: e.name, start: e.startTime, dur: e.duration, id: e.interactionId,
        delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart,
        pres: e.startTime + e.duration - e.processingEnd,
      });
    }
  }).observe({ type: 'event', durationThreshold: 16, buffered: true } as PerformanceObserverInit);

  new PerformanceObserver((l) => {
    for (const e of l.getEntries() as any[]) {
      P.shifts.push({
        t: Math.round(e.startTime), value: e.value, recent: e.hadRecentInput,
        sources: (e.sources || []).map((s: any) => ({
          node: s.node ? `${s.node.nodeName}.${String(s.node.className || '').split(' ').slice(0, 3).join('.')}` : null,
          from: s.previousRect && [Math.round(s.previousRect.x), Math.round(s.previousRect.y), Math.round(s.previousRect.width), Math.round(s.previousRect.height)],
          to: s.currentRect && [Math.round(s.currentRect.x), Math.round(s.currentRect.y), Math.round(s.currentRect.width), Math.round(s.currentRect.height)],
        })),
      });
    }
  }).observe({ type: 'layout-shift', buffered: true });

  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries() as any[]) {
        P.loaf.push({
          t: Math.round(e.startTime), dur: Math.round(e.duration), blocking: Math.round(e.blockingDuration),
          scripts: (e.scripts || []).map((s: any) => ({ inv: s.invoker, fn: s.sourceFunctionName, dur: Math.round(s.duration), fwd: Math.round(s.forcedStyleAndLayoutDuration || 0) })),
        });
      }
    }).observe({ type: 'long-animation-frame', buffered: true });
  } catch { /* unsupported */ }

  // React commit counter through the DevTools hook (works in production builds).
  // A function component rendered in a commit when it has PerformedWork (flag 1)
  // and its props/state differ from the alternate (a bailed-out fiber keeps old flags).
  const hostClass = (f: any): string => {
    let c = f.child;
    while (c && c.tag !== 5) c = c.child;
    return c && c.stateNode && typeof c.stateNode.className === 'string' ? c.stateNode.className : '';
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject(r: any) { this.renderers.set(1, r); return 1; },
    checkDCE() {}, onScheduleFiberRoot() {}, onPostCommitFiberRoot() {}, onCommitFiberUnmount() {},
    onCommitFiberRoot(_id: number, root: any) {
      let fibers = 0, menuCards = 0, cartLines = 0, kds = 0, keys = 0;
      const stack = [root.current];
      while (stack.length) {
        const f = stack.pop();
        if (!f) continue;
        if (f.sibling) stack.push(f.sibling);
        // Same rule as React DevTools: a subtree whose child pointer is shared with the
        // previous tree was not cloned (bailed out) — none of it rendered this commit.
        if (f.child && (!f.alternate || f.child !== f.alternate.child)) stack.push(f.child);
        if (f.tag !== 0 && f.tag !== 11 && f.tag !== 14 && f.tag !== 15) continue;
        if (!(f.flags & 1)) continue;
        const a = f.alternate;
        if (a && a.memoizedProps === f.memoizedProps && a.memoizedState === f.memoizedState) continue;
        fibers++;
        const cls = hostClass(f);
        if (cls.includes('menu-card')) menuCards++;
        else if (cls.includes('pos-line')) cartLines++;
        else if (cls.includes('kds')) kds++;
        else if (cls.includes('ui-key')) keys++;
      }
      P.commits.push({ t: Math.round(performance.now()), fibers, menuCards, cartLines, kds, keys });
    },
  };

  // Feedback probe: pointerdown timestamp -> the animation frame in which `cond` first holds.
  P.arm = (cond: any) => {
    P.feedback = { t0: null, t1: null };
    const fb = P.feedback;
    const check = () => {
      if (cond.count) return document.querySelectorAll(cond.count[0]).length === cond.count[1];
      const scopes = Array.from(document.querySelectorAll(cond.scope || 'body'))
        .filter((e) => !cond.hasText || (e.textContent || '').includes(cond.hasText));
      return scopes.some((s) => {
        const el = cond.inner ? s.querySelector(cond.inner) : s;
        return !!el && (cond.text == null || (el.textContent || '').trim() === cond.text);
      });
    };
    document.addEventListener('pointerdown', (e) => { if (fb.t0 == null) fb.t0 = e.timeStamp; }, { capture: true, once: true });
    const mo = new MutationObserver(() => {
      if (fb.t1 != null || !check()) return;
      fb.t1 = -1;
      requestAnimationFrame(() => { fb.t1 = performance.now(); mo.disconnect(); });
    });
    mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
  };
}

// ── fixtures ─────────────────────────────────────────────────────────────────
type Fixtures = { api: MockApi; app: Page; cdp: CDPSession };

const test = base.extend<Fixtures>({
  api: async ({ page }, provide) => {
    const api = new MockApi();
    seedCaptureApi(api);
    const cats = api.categories.map((c) => c.id);
    for (let i = 0; i < EXTRA_PRODUCTS; i++) {
      api.products = [...api.products, { id: `p-x${i}`, name: `เมนูทดสอบ ${i + 1}`, price: `${40 + (i % 9) * 5}.00`, category_id: cats[i % cats.length] }];
    }
    await api.install(page);
    await page.route(/^http:\/\/127\.0\.0\.1:8080\//, (r) => r.abort());
    await provide(api);
  },
  cdp: async ({ page }, provide) => {
    const cdp = await page.context().newCDPSession(page);
    await provide(cdp);
  },
  app: async ({ page, context, api, baseURL }, provide) => {
    await page.addInitScript(instrument);
    await page.addInitScript(() => localStorage.setItem('kafe:store-slug', 'e2e-shop'));
    await api.signIn(context, baseURL!);
    await page.goto('/');
    await expect(card(page, 'ลาเต้ร้อน')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    await provide(page);
  },
});

// Same knob the capture config sets per project (typed loosely there via the devices spread).
test.use({ reducedMotion: process.env.PERF_REDUCED ? 'reduce' : 'no-preference' } as Record<string, unknown>);

const card = (page: Page, name: string) => page.locator('button.menu-card').filter({ hasText: name }).filter({ visible: true }).first();
const DETAIL = /^\/api\/v1\/products\/[^/]+$/;

function save(info: { project: { name: string }; title: string }, data: unknown) {
  fs.mkdirSync(OUT, { recursive: true });
  const f = path.join(OUT, `${info.project.name}__${info.title.replace(/\W+/g, '_')}.json`);
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
}

async function throttle(cdp: CDPSession, rate = THROTTLE) {
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

async function reset(page: Page) {
  await page.evaluate(() => { const P = (window as any).__perf; P.events = []; P.shifts = []; P.loaf = []; P.commits = []; });
}

interface Sample { feedback: number | null; inp: number | null; delay?: number; proc?: number; pres?: number; commits: any[]; loaf: any[] }

/** One interaction with the probe armed -> feedback frame time, worst event (INP-style), commits. */
async function measure(page: Page, cond: object, act: () => Promise<void>, settleMs = 700): Promise<Sample> {
  await reset(page);
  await page.evaluate((c) => (window as any).__perf.arm(c), cond);
  await act();
  await page.waitForTimeout(settleMs);
  return page.evaluate(() => {
    const P = (window as any).__perf;
    const fb = P.feedback;
    const byId = new Map<number, any>();
    for (const e of P.events) {
      if (!e.id) continue;
      const cur = byId.get(e.id);
      if (!cur || e.dur > cur.dur) byId.set(e.id, e);
    }
    const worst = [...byId.values()].sort((a, b) => b.dur - a.dur)[0];
    return {
      feedback: fb && fb.t0 != null && fb.t1 > 0 ? Math.round((fb.t1 - fb.t0) * 10) / 10 : null,
      inp: worst ? worst.dur : null, // null = every event < 16ms (below the Event Timing threshold)
      delay: worst ? Math.round(worst.delay) : undefined,
      proc: worst ? Math.round(worst.proc) : undefined,
      pres: worst ? Math.round(worst.pres) : undefined,
      commits: P.commits,
      loaf: P.loaf.filter((l: any) => l.dur >= 50),
    };
  });
}

function summarize(samples: Sample[]) {
  const fb = samples.map((s) => s.feedback).filter((x): x is number => x != null).sort((a, b) => a - b);
  const inp = samples.map((s) => s.inp ?? 8).sort((a, b) => a - b);
  const pct = (a: number[], p: number) => (a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null);
  const worst = [...samples].sort((a, b) => (b.inp ?? 0) - (a.inp ?? 0))[0];
  return {
    n: samples.length,
    feedbackMs: { p50: pct(fb, 0.5), p90: pct(fb, 0.9), max: fb[fb.length - 1] ?? null, all: samples.map((s) => s.feedback) },
    inpMs: { p50: pct(inp, 0.5), p90: pct(inp, 0.9), max: inp[inp.length - 1], all: samples.map((s) => s.inp) },
    worst: { inp: worst?.inp, delay: worst?.delay, proc: worst?.proc, pres: worst?.pres, loaf: worst?.loaf },
    commits: samples.map((s) => s.commits.map((c) => `${c.fibers}f/${c.menuCards}mc/${c.cartLines}cl/${c.kds}k/${c.keys}key@${c.t}`).join(' ')),
  };
}

async function shifts(page: Page) {
  return page.evaluate(() => {
    const all = (window as any).__perf.shifts as any[];
    return {
      raw: Math.round(all.reduce((s, e) => s + e.value, 0) * 10000) / 10000,
      cls: Math.round(all.filter((e) => !e.recent).reduce((s, e) => s + e.value, 0) * 10000) / 10000,
      entries: all.slice(0, 6),
    };
  });
}

/** Wait until the background detail prefetch stops issuing requests. */
async function prefetchQuiet(api: MockApi) {
  let prev = -1;
  await expect.poll(() => { const n = api.find('GET', DETAIL).length; const same = n === prev && n > 0; prev = n; return same; },
    { intervals: [1500], timeout: 40_000 }).toBe(true);
}

// ── 1 · product card tap, qty stepper, cart undo bar ─────────────────────────
test('add-to-cart', async ({ app: page, cdp, api }, info) => {
  const R: Record<string, unknown> = {};
  await prefetchQuiet(api);
  R.prefetchOnLoad = api.find('GET', DETAIL).length;
  R.loadCls = await shifts(page);
  await throttle(cdp);

  const names = ['อเมริกาโน่', 'ครัวซองต์', 'เอสเพรสโซ่', 'อเมริกาโน่', 'โกโก้เย็น', 'อเมริกาโน่', 'เลมอนโซดา', 'ครัวซองต์', 'อเมริกาโน่', 'ยูซุโซดา', 'บราวนี่ช็อกโกแลต', 'อเมริกาโน่'];
  const counts = new Map<string, number>();
  const S: Sample[] = [];
  const d0 = api.find('GET', DETAIL).length;
  for (const n of names) {
    const next = (counts.get(n) ?? 0) + 1;
    counts.set(n, next);
    S.push(await measure(page, { scope: 'button.menu-card', hasText: n, inner: '.pos-card-qty', text: String(next) }, () => card(page, n).tap()));
  }
  R.tapProduct = summarize(S);
  R.detailRequestsDuringTaps = api.find('GET', DETAIL).length - d0;
  R.lines = await page.locator('.pos-line').count();

  const line = page.locator('.pos-line').filter({ hasText: 'อเมริกาโน่' }).first();
  const qty = async () => Number((await line.locator('.pos-qty').textContent())?.trim());
  const inc: Sample[] = [];
  for (let i = 0; i < 10; i++) {
    const q = await qty();
    inc.push(await measure(page, { scope: '.pos-line', hasText: 'อเมริกาโน่', inner: '.pos-qty', text: String(q + 1) }, () => line.getByRole('button', { name: 'เพิ่มจำนวน' }).tap(), 500));
  }
  R.qtyPlus = summarize(inc);
  const dec: Sample[] = [];
  for (let i = 0; i < 6; i++) {
    const q = await qty();
    dec.push(await measure(page, { scope: '.pos-line', hasText: 'อเมริกาโน่', inner: '.pos-qty', text: String(q - 1) }, () => line.getByRole('button', { name: 'ลดจำนวน' }).tap(), 500));
  }
  R.qtyMinus = summarize(dec);

  // trash -> UndoBar pinned over the line list
  const tops = () => page.locator('.pos-line').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const before = await tops();
  await reset(page);
  await page.locator('.pos-line').last().locator('.pos-line-remove').tap();
  await expect(page.locator('.undo-bar')).toBeVisible();
  await page.waitForTimeout(700);
  R.cartUndoAppear = { before, after: await tops(), ...(await shifts(page)) };
  await reset(page);
  await expect(page.locator('.undo-bar')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(400);
  R.cartUndoTimeout = { after: await tops(), ...(await shifts(page)) };

  // background work triggered by one tap (promo evaluate etc.)
  await reset(page);
  await card(page, 'อเมริกาโน่').tap();
  await page.waitForTimeout(1500);
  R.afterOneTap = await page.evaluate(() => ({ commits: (window as any).__perf.commits, loaf: (window as any).__perf.loaf.filter((l: any) => l.dur >= 30) }));
  save(info, R);
  console.log(JSON.stringify(R));
});

// ── 2 · prefetch per category switch ─────────────────────────────────────────
test('prefetch', async ({ app: page, cdp, api }, info) => {
  const R: Record<string, unknown> = {};
  await prefetchQuiet(api);
  R.onLoad = api.find('GET', DETAIL).length;
  await throttle(cdp);
  const chips = page.locator('.tab-strip > .pos-chip');
  const n = await chips.count();
  const per: unknown[] = [];
  const S: Sample[] = [];
  for (let i = 2; i < n; i++) {
    const label = (await chips.nth(i).textContent())?.trim();
    const b = api.find('GET', DETAIL).length;
    S.push(await measure(page, { scope: '.pos-chip[aria-pressed="true"]', hasText: label }, () => chips.nth(i).tap(), 3000));
    per.push({ label, requests: api.find('GET', DETAIL).length - b, cards: await page.locator('button.menu-card').count() });
  }
  R.perSwitch = per;
  R.switchInteraction = summarize(S);
  R.switchShifts = await shifts(page);
  let b = api.find('GET', DETAIL).length;
  await chips.nth(2).tap(); await page.waitForTimeout(1500);
  await chips.nth(1).tap(); await page.waitForTimeout(1500);
  R.revisitRequests = api.find('GET', DETAIL).length - b;
  b = api.find('GET', DETAIL).length;
  await page.locator('.pos-search').fill('');
  await page.locator('.pos-search').click();
  for (const ch of ['เ', 'ม', 'น', 'ู']) { await page.keyboard.type(ch); await page.waitForTimeout(120); }
  await page.waitForTimeout(2000);
  R.searchTypingRequests = api.find('GET', DETAIL).length - b;
  R.detailBodyBytes = await page.evaluate(async () => (await (await fetch('/api/v1/products/p-latte')).text()).length);
  save(info, R);
  console.log(JSON.stringify(R));
});

test('cold tap', async ({ page, context, api, baseURL, cdp }, info) => {
  // 150ms upstream latency on product detail so the cold path is visible.
  api.extra.unshift(async (c) => { if (DETAIL.test(c.path)) await new Promise((r) => setTimeout(r, 150)); return false; });
  await page.addInitScript(instrument);
  await page.addInitScript(() => localStorage.setItem('kafe:store-slug', 'e2e-shop'));
  await api.signIn(context, baseURL!);
  await page.goto('/');
  await expect(card(page, 'ครัวซองต์')).toBeVisible();
  await throttle(cdp);
  const pending = await measure(page, { scope: 'button.menu-card', hasText: 'ครัวซองต์', inner: '.pos-card-qty', text: '1' }, () => card(page, 'ครัวซองต์').tap(), 1500);
  const R = { tapToLineLanded: pending.feedback, inp: pending.inp, commits: pending.commits.length };
  save(info, R);
  console.log(JSON.stringify(R));
});

// ── 3 · cash keypad + toast ──────────────────────────────────────────────────
test('cash keypad', async ({ app: page, cdp }, info) => {
  const R: Record<string, unknown> = {};
  for (const n of ['อเมริกาโน่', 'ครัวซองต์', 'อเมริกาโน่']) { await card(page, n).tap(); await page.waitForTimeout(200); }
  await expect(page.locator('.pos-line')).toHaveCount(2);
  await page.getByRole('button', { name: /^\s*เงินสด\s*$/ }).first().tap();
  const dialog = page.getByRole('dialog', { name: 'รับเงินสด' });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(800);
  await throttle(cdp);
  const pad = dialog.getByRole('group', { name: 'แป้นตัวเลข' });
  const S: Sample[] = [];
  let typed = '';
  for (const k of ['1', '5', '0', '0', '0', '9', '8', '7']) {
    typed += k;
    S.push(await measure(page, { scope: '[data-cash-entry]', hasText: Number(typed).toLocaleString('en-US') }, () => pad.getByRole('button', { name: k, exact: true }).tap(), 350));
  }
  R.keypad = summarize(S);
  R.entryText = await dialog.locator('[data-cash-entry]').textContent();
  await reset(page);
  const confirm = dialog.getByRole('button', { name: /ยืนยันรับเงิน/ });
  if (await confirm.isEnabled()) {
    await confirm.tap();
    // No "paid" toast any more: the receipt dialog is the confirmation.
    await expect(page.getByRole('dialog', { name: 'ใบเสร็จรับเงิน' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    R.payToastShifts = await shifts(page);
  }
  save(info, R);
  console.log(JSON.stringify(R));
});

// ── 4 · KDS bump + undo row ──────────────────────────────────────────────────
test('kds bump', async ({ app: page, cdp }, info) => {
  const R: Record<string, unknown> = {};
  const group = page.locator('#sb-group-sec-service');
  if ((await group.count()) && (await group.getAttribute('aria-expanded')) === 'false') await group.click();
  await page.locator('aside [data-nav-id="kds"]').click();
  await expect(page.locator('.kds-bump').first()).toBeVisible();
  await page.waitForTimeout(1500);
  await throttle(cdp);
  const tops = () => page.locator('.kds-bump').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  const S: Sample[] = [];
  const sh: unknown[] = [];
  for (let i = 0; i < 6; i++) {
    const b = page.locator('.kds-bump').filter({ visible: true }).first();
    if (!(await b.count())) break;
    const before = await tops();
    S.push(await measure(page, { scope: '.undo-bar' }, () => b.tap(), 1000));
    sh.push({ before, after: await tops(), ...(await shifts(page)) });
  }
  R.bump = summarize(S);
  R.bumpShifts = sh;
  await expect(page.locator('.undo-bar')).toHaveCount(0, { timeout: 10_000 });
  const scroller = page.locator('.surface-inverse .scroll').first();
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(300);
  await reset(page);
  const last = page.locator('.kds-bump').filter({ visible: true }).last();
  if (await last.count()) {
    const before = await tops();
    await last.tap();
    await page.waitForTimeout(1000);
    R.bumpScrolledBottom = { before, after: await tops(), ...(await shifts(page)) };
    await reset(page);
    await expect(page.locator('.undo-bar')).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(400);
    R.undoTimeoutShifts = { after: await tops(), ...(await shifts(page)) };
  }
  save(info, R);
  console.log(JSON.stringify(R));
});

// ── 5 · sidebar rail -> overlay ──────────────────────────────────────────────
test('sidebar', async ({ app: page, cdp }, info) => {
  await throttle(cdp);
  const grid = page.locator('.pos-grid').first();
  const gBefore = await grid.boundingBox();
  const open = await measure(page, { scope: 'aside', hasText: '' }, () => page.getByRole('button', { name: 'ขยายเมนู' }).tap(), 1000);
  const gAfter = await grid.boundingBox();
  const openShifts = await shifts(page);
  await reset(page);
  await page.getByRole('button', { name: 'ย่อเมนู' }).tap();
  await page.waitForTimeout(1000);
  const R = { openInp: open.inp, openCommits: open.commits, openLoaf: open.loaf, gBefore, gAfter, openShifts, closeShifts: await shifts(page), gClosed: await grid.boundingBox() };
  save(info, R);
  console.log(JSON.stringify(R));
});
