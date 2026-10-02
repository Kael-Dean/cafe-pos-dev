'use client';

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import Icon from '../icons';
import { ModalShell } from '../layout';
import { useI18n } from '@/lib/i18n';
import { useInstallPrompt, type InstallOutcome } from '@/hooks/use-install-prompt';
import { ART_LABELS } from './install-art/labels';
import { SCENES, SCENE_ASPECT, type GuidePlatform } from './install-art/scenes';

const PLATFORMS: readonly GuidePlatform[] = ['pc', 'ios', 'mac', 'android'];

/* Screen-specific styles. Prefix `ig-`. */
const STYLES = `
.ig-tabs {
  display: flex; gap: 4px; padding: 4px; margin-bottom: var(--space-4);
  background: var(--color-surface-2); border-radius: 10px;
}
.ig-tab {
  flex: 1 1 auto; min-width: 0; min-height: 44px; padding: 6px 8px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;
  border: none; border-radius: 8px; cursor: pointer; font-family: inherit;
  font-size: 13px; font-weight: 600; line-height: 1.25; text-align: center; text-wrap: balance;
  /* --color-text-secondary alone is 4.29:1 on --color-surface-2 (light); pulled 10% toward
     --color-text it is 4.9:1 and still ~3:1 apart from the selected tab's label. */
  background: transparent; color: color-mix(in oklab, var(--color-text-secondary) 90%, var(--color-text));
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.ig-tab:hover { color: var(--color-text); }
.ig-tab[aria-selected="true"] {
  background: var(--color-surface); color: var(--color-text); font-weight: 700;
  /* Inset primary ring: in dark theme the surface chip alone barely differs from the track. */
  box-shadow: inset 0 0 0 1.5px var(--color-primary), var(--shadow-xs);
}
.ig-badge {
  display: inline-flex; align-items: center; gap: 3px; white-space: nowrap;
  font-size: 11px; font-weight: 600; line-height: 1.3; color: var(--color-primary);
}
.ig-badge::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: currentColor; }

.ig-callout {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 12px 14px; margin-bottom: var(--space-4);
  border-radius: var(--radius-lg); background: var(--color-surface-2);
}
.ig-callout:focus { outline: none; }
.ig-callout:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
.ig-callout-title { font-size: 14px; font-weight: 700; line-height: 1.45; }
.ig-callout-desc { font-size: 13px; line-height: 1.55; color: var(--color-text-secondary); }
.ig-now { flex-wrap: wrap; align-items: center; }
.ig-now .ig-callout-title { flex: 1 1 180px; font-weight: 600; }
.ig-now .btn { min-height: 44px; }

.ig-track {
  position: relative;
  display: flex; gap: var(--space-4);
  overflow-x: auto; overflow-y: hidden;
  scroll-snap-type: x mandatory; overscroll-behavior-x: contain;
  scrollbar-width: none; border-radius: var(--radius-lg);
}
.ig-track::-webkit-scrollbar { display: none; }
.ig-track:focus { outline: none; }
.ig-track:focus-visible { outline: 2px solid var(--color-focus-ring); outline-offset: 2px; }
.ig-slide { flex: 0 0 100%; min-width: 0; scroll-snap-align: start; scroll-snap-stop: always; }
/* ‹ › arrows over the picture, so it's obvious there are more steps to the side.
   Centred on the scene stage (its height is measured into --ig-stage-h). */
.ig-viewport { position: relative; }
.ig-arrow {
  position: absolute; top: calc(var(--ig-stage-h, 200px) / 2); transform: translateY(-50%);
  width: 44px; height: 44px; padding: 0; border-radius: 999px; cursor: pointer;
  display: grid; place-items: center;
  background: var(--color-surface); color: var(--color-text);
  border: 1px solid var(--color-border-strong, var(--color-border)); box-shadow: var(--shadow-sm, 0 2px 6px rgb(0 0 0 / .12));
  transition: background var(--dur-base, 150ms) var(--ease-out, ease), opacity var(--dur-base, 150ms) var(--ease-out, ease);
}
.ig-arrow--prev { left: 6px; }
.ig-arrow--next { right: 6px; }
.ig-arrow[hidden] { display: none; }
.ig-arrow--next.ig-arrow--hint { background: var(--color-primary); color: var(--color-text-inverse); border-color: var(--color-primary); animation: ig-nudge 1.2s var(--ease-out, ease) 3; }
@media (hover: hover) { .ig-arrow:hover { background: var(--color-surface-2); } .ig-arrow--next.ig-arrow--hint:hover { background: var(--color-primary); } }
.ig-arrow:active { transform: translateY(-50%) scale(.94); }
@keyframes ig-nudge { 0%, 60%, 100% { transform: translateY(-50%) translateX(0); } 30% { transform: translateY(-50%) translateX(4px); } }
.ig-stage {
  display: flex; justify-content: center; align-items: center;
  padding: 12px; border-radius: var(--radius-lg); background: var(--color-surface-2);
}
/* Natural legibility caps: never upscale a scene past its drawing size much.
   Phone scenes also shrink with the viewport height so step text stays close. */
.ig-scene { width: 100%; }
/* Off-screen steps never pulse; the current one restarts its (short) pulse each time it
   becomes current. */
.ig-slide[aria-hidden="true"] .kafe-art-pulse { animation: none; }
.ig-scene--desktop { max-width: 400px; }
.ig-scene--phone { max-width: min(240px, 28dvh); }
.ig-step { margin-top: var(--space-3); }
.ig-step-of { font-size: 12px; font-weight: 600; color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }
.ig-step-title { margin: 2px 0 4px; font-size: 16px; font-weight: 700; line-height: 1.4; text-wrap: balance; }
.ig-step-body { margin: 0; font-size: 14px; line-height: 1.6; color: var(--color-text); max-width: 65ch; }

.ig-dots { display: flex; justify-content: center; margin-top: var(--space-1); }
.ig-dot {
  width: 44px; height: 44px; padding: 0; border: none; background: transparent; cursor: pointer;
  display: grid; place-items: center; border-radius: var(--radius-md);
}
.ig-dot > span {
  display: block; width: 8px; height: 8px; border-radius: 999px;
  /* The dot is the button's only visible shape: >= 3:1 against the card (1.4.11).
     --color-border-strong was ~1.7:1 in both themes. */
  background: var(--color-text-muted);
  transition: background var(--dur-fast) var(--ease-out);
}
.ig-dot[aria-current="step"] > span { width: 22px; background: var(--color-primary); }
.ig-dot:hover > span { background: var(--color-text); }
.ig-dot[aria-current="step"]:hover > span { background: var(--color-primary); }

.ig-note {
  display: flex; align-items: flex-start; gap: 8px; margin: var(--space-2) 0 0;
  font-size: 13px; line-height: 1.55; color: var(--color-text-secondary);
}
.ig-note svg { flex-shrink: 0; margin-top: 2px; }

.ig-nav { min-height: 44px; }
.ig-nav[aria-disabled="true"] { opacity: 0.45; cursor: default; }
.ig-nav[aria-disabled="true"]:hover { background: transparent; }

@media (max-width: 767px) {
  .ig-tab { padding: 6px 4px; }
  .ig-step-title { font-size: 15px; }
}
@media (prefers-reduced-motion: reduce) {
  .ig-dot > span, .ig-tab, .ig-arrow { transition: none; }
  .ig-arrow--next.ig-arrow--hint { animation: none; }
}
`;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Illustrated "install Kafé OS" guide: platform tabs, then one drawn scene per
 * step in a swipeable scroll-snap slider. Mount only while open.
 */
export function InstallGuideDialog({ initialPlatform, onClose }: { initialPlatform: GuidePlatform; onClose: () => void }) {
  const { t, lang } = useI18n();
  const g = t.pwa.guide;
  const { platform: installState, canPrompt, promptInstall } = useInstallPrompt();
  const detected = initialPlatform;

  const [platform, setPlatform] = useState<GuidePlatform>(initialPlatform);
  const [index, setIndex] = useState(0);
  // What the live region says. Only set when a slide change has settled, never on
  // open or on every scroll tick.
  const [announced, setAnnounced] = useState('');

  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null);

  const baseId = useId();
  const tabId = (p: GuidePlatform) => `${baseId}-tab-${p}`;
  const panelId = `${baseId}-panel`;

  const tabRefs = useRef<Partial<Record<GuidePlatform, HTMLButtonElement | null>>>({});
  const trackRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const rafId = useRef<number | undefined>(undefined);
  /** Slide a button/key asked for; scroll ticks are ignored until it settles. */
  const target = useRef<number | null>(null);

  const steps = g.steps[platform];
  const total = steps.length;
  const Scenes = SCENES[platform];
  const aspect = SCENE_ASPECT[platform];
  const labels = ART_LABELS[lang];
  const isLast = index === total - 1;

  // ModalShell focuses its first control (the close button) in its own mount
  // effect, which runs after ours; land on the selected tab instead so arrow
  // keys work straight away.
  useEffect(() => {
    const id = requestAnimationFrame(() => tabRefs.current[initialPlatform]?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, [initialPlatform]);

  useEffect(() => () => {
    window.clearTimeout(settleTimer.current);
    if (rafId.current) cancelAnimationFrame(rafId.current);
  }, []);

  // Centre the ‹ › arrows on the picture: measure the scene stage of the first
  // slide (all slides of a platform share one aspect, so one stage is enough).
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    const stage = trackRef.current?.querySelector<HTMLElement>('.ig-stage');
    if (!viewport || !stage) return;
    const sync = () => viewport.style.setProperty('--ig-stage-h', `${stage.offsetHeight}px`);
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [platform]);

  // The next arrow nudges until the user has moved past step 1 once, so nobody
  // mistakes the first picture for the whole guide.
  const [movedOn, setMovedOn] = useState(false);
  if (index > 0 && !movedOn) setMovedOn(true);

  const nearestSlide = useCallback((): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const slides = Array.from(track.children) as HTMLElement[];
    let best = 0;
    let bestDist = Infinity;
    slides.forEach((slide, i) => {
      const d = Math.abs(slide.offsetLeft - track.scrollLeft);
      if (d < bestDist) { bestDist = d; best = i; }
    });
    return best;
  }, []);

  const announce = useCallback((i: number) => {
    const step = g.steps[platform][i];
    if (step) setAnnounced(`${g.stepOf(i + 1, g.steps[platform].length)}. ${step.title}`);
  }, [g, platform]);

  const settle = useCallback(() => {
    target.current = null;
    const i = nearestSlide();
    setIndex(i);
    announce(i);
  }, [announce, nearestSlide]);

  const onScroll = () => {
    // Follow the finger: update the dots on the next frame while a manual swipe
    // is in progress, and announce only after scrolling has stopped.
    if (target.current == null && rafId.current == null) {
      rafId.current = requestAnimationFrame(() => {
        rafId.current = undefined;
        if (target.current == null) setIndex(nearestSlide());
      });
    }
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(settle, 140);
  };

  const goTo = (i: number) => {
    const track = trackRef.current;
    if (!track) return;
    const clamped = Math.max(0, Math.min(total - 1, i));
    const slide = track.children[clamped] as HTMLElement | undefined;
    if (!slide) return;
    setIndex(clamped);
    if (Math.abs(track.scrollLeft - slide.offsetLeft) < 1) {
      // Already there (no scroll event will fire).
      target.current = null;
      announce(clamped);
      return;
    }
    target.current = clamped;
    track.scrollTo({ left: slide.offsetLeft, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const selectPlatform = (p: GuidePlatform, focus = false) => {
    window.clearTimeout(settleTimer.current);
    target.current = null;
    setPlatform(p);
    setIndex(0);
    setAnnounced('');
    if (focus) tabRefs.current[p]?.focus();
  };

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const at = PLATFORMS.indexOf(platform);
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (at + 1) % PLATFORMS.length;
    else if (e.key === 'ArrowLeft') next = (at - 1 + PLATFORMS.length) % PLATFORMS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = PLATFORMS.length - 1;
    if (next == null) return;
    e.preventDefault();
    selectPlatform(PLATFORMS[next], true);
  };

  const onSliderKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); goTo(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(index - 1); }
  };

  const onPrev = () => { if (index > 0) goTo(index - 1); };
  const onNext = () => { if (isLast) onClose(); else goTo(index + 1); };

  // "Previous" uses aria-disabled rather than disabled, so a keyboard user who
  // pressed it back to step 1 keeps focus on it instead of falling to <body>.
  const prevDisabled = index === 0;

  const installNow = async () => {
    if (pending) return;
    setPending(true);
    const result = await promptInstall();
    setOutcome(result);
    setPending(false);
    // The install button is gone now; park focus on the result.
    requestAnimationFrame(() => statusRef.current?.focus({ preventScroll: true }));
  };

  const installed = installState === 'installed';
  const showInstallNow = canPrompt || pending;

  return (
    <ModalShell
      title={g.title}
      subtitle={g.subtitle}
      onClose={onClose}
      width={440}
      busy={pending}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost ig-nav"
            onClick={onPrev}
            aria-disabled={prevDisabled || undefined}
          >
            <Icon name="chevronLeft" size={16} />
            {g.prev}
          </button>
          <button type="button" className="btn btn-primary ig-nav" onClick={onNext}>
            {isLast ? g.finish : g.next}
            {!isLast && <Icon name="chevronRight" size={16} />}
          </button>
        </>
      }
    >
      <style>{STYLES}</style>

      {/* Install status: filled in after the browser's own dialog answers. */}
      <div role="status" ref={statusRef} tabIndex={-1} className={outcome ? 'ig-callout' : undefined}>
        {outcome && installed && (
          <>
            <Icon name="success" size={20} color="var(--color-success)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div className="ig-callout-title">{t.pwa.installedTitle}</div>
              <div className="ig-callout-desc">{t.pwa.installedDesc}</div>
            </div>
          </>
        )}
        {outcome && !installed && (
          <>
            <Icon name="info" size={20} color="var(--color-info)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div className="ig-callout-desc" style={{ color: 'var(--color-text)' }}>{t.pwa.installDismissed}</div>
          </>
        )}
      </div>

      {showInstallNow && !outcome && (
        <div className="ig-callout ig-now">
          <Icon name="download" size={20} color="var(--color-primary)" style={{ flexShrink: 0 }} />
          <div className="ig-callout-title">{g.installNowTitle}</div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { void installNow(); }}
            disabled={pending}
            aria-busy={pending || undefined}
            style={{ cursor: pending ? 'progress' : 'pointer' }}
          >
            {pending
              ? <span className="spinner" aria-hidden style={{ width: 16, height: 16 }} />
              : <Icon name="download" size={18} />}
            {pending ? t.pwa.installWaiting : g.installNowButton}
          </button>
        </div>
      )}

      {installState === 'unsupported' && (
        <div className="ig-callout">
          <Icon name="info" size={20} color="var(--color-info)" style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            <div className="ig-callout-title">{t.pwa.unsupportedTitle}</div>
            <div className="ig-callout-desc">{t.pwa.unsupportedDesc}</div>
          </div>
        </div>
      )}

      <div role="tablist" aria-label={g.tabsLabel} className="ig-tabs">
        {PLATFORMS.map((p) => {
          const selected = p === platform;
          return (
            <button
              key={p}
              ref={(el) => { tabRefs.current[p] = el; }}
              id={tabId(p)}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              className="ig-tab"
              onClick={() => { if (!selected) selectPlatform(p); }}
              onKeyDown={onTabKey}
            >
              <span>{g.tabs[p]}</span>
              {p === detected && <span className="ig-badge">{g.detected}</span>}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={tabId(platform)}>
        <div
          role="region"
          aria-roledescription="carousel"
          aria-label={g.slidesLabel}
          onKeyDown={onSliderKey}
        >
          <div ref={viewportRef} className="ig-viewport">
          {/* key: a new platform gets a fresh track, scrolled to step 1. */}
          <div
            key={platform}
            ref={trackRef}
            className="ig-track"
            tabIndex={0}
            onScroll={onScroll}
          >
            {steps.map((step, i) => {
              const Scene = Scenes[i];
              return (
                <div
                  key={i}
                  className="ig-slide"
                  role="group"
                  aria-roledescription="slide"
                  aria-label={g.stepOf(i + 1, total)}
                  aria-hidden={i !== index || undefined}
                >
                  <div className="ig-stage">
                    <div className={`ig-scene ig-scene--${aspect}`}>
                      {Scene && <Scene labels={labels} ariaLabel={step.body} />}
                    </div>
                  </div>
                  <div className="ig-step">
                    <div className="ig-step-of">{g.stepOf(i + 1, total)}</div>
                    <h3 className="ig-step-title">{step.title}</h3>
                    <p className="ig-step-body">{step.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
            <button
              type="button"
              className="ig-arrow ig-arrow--prev"
              aria-label={g.prev}
              hidden={index === 0}
              onClick={(e) => {
                // Arriving at step 1 hides this arrow; keep keyboard focus in the carousel.
                if (index === 1 && document.activeElement === e.currentTarget) trackRef.current?.focus({ preventScroll: true });
                onPrev();
              }}
            >
              <Icon name="chevronLeft" size={20} />
            </button>
            <button
              type="button"
              className={`ig-arrow ig-arrow--next${movedOn ? '' : ' ig-arrow--hint'}`}
              aria-label={g.next}
              hidden={isLast}
              onClick={(e) => {
                // Arriving at the last step hides this arrow; keep keyboard focus in the carousel.
                if (index === total - 2 && document.activeElement === e.currentTarget) trackRef.current?.focus({ preventScroll: true });
                goTo(index + 1);
              }}
            >
              <Icon name="chevronRight" size={20} />
            </button>
          </div>

          <div className="ig-dots">
            {steps.map((_, i) => (
              <button
                key={i}
                type="button"
                className="ig-dot"
                aria-label={g.goToStep(i + 1)}
                aria-current={i === index ? 'step' : undefined}
                onClick={() => goTo(i)}
              >
                <span aria-hidden />
              </button>
            ))}
          </div>

          <div aria-live="polite" aria-atomic="true" className="sr-only">{announced}</div>
        </div>

        <p className="ig-note">
          <Icon name="info" size={16} />
          <span>{g.notes[platform]}</span>
        </p>
      </div>
    </ModalShell>
  );
}
