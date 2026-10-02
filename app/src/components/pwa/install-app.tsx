'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { useInstallPrompt, type InstallOutcome } from '@/hooks/use-install-prompt';
import { InstallGuideDialog } from './install-guide';

/** Shared button + prompt state for the `chromium-prompt` platform. */
function useInstallAction() {
  const { platform, guide, promptInstall } = useInstallPrompt();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null);

  const run = async () => {
    if (pending) return;
    setPending(true);
    const result = await promptInstall();
    setOutcome(result);
    setPending(false);
  };

  return { platform, guide, pending, dismissed: outcome === 'dismissed', run };
}

/**
 * Settings → "Install app". Mirrors the Language / Appearance cards and shows the
 * one action that works on this device: a real install button where the browser
 * offers one, plus the illustrated step-by-step guide for every other case.
 */
export function InstallCard() {
  const { t } = useI18n();
  const { platform, guide, pending, dismissed, run } = useInstallAction();
  const [guideOpen, setGuideOpen] = useState(false);
  const titleId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const prompted = useRef(false);

  // The install button unmounts as soon as the native dialog resolves (the
  // platform becomes `installed` or falls back to the guide), which would
  // drop keyboard focus to <body>. Park it on the card instead, so the next Tab
  // continues from here and a screen reader lands on the result.
  useEffect(() => {
    if (!prompted.current || platform === 'chromium-prompt') return;
    prompted.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) sectionRef.current?.focus({ preventScroll: true });
  }, [platform]);

  const showGuide = platform !== 'unknown' && platform !== 'installed';

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={titleId}
      className="pad-phone" // 24px card padding → 16px on phones
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, marginBottom: 16, maxWidth: 560 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--color-accent-50)', color: 'var(--color-primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
          <Icon name="download" size={20} />
        </div>
        <div>
          <h2 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{t.pwa.installTitle}</h2>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.pwa.installDesc}</div>
        </div>
      </div>

      {/* minHeight reserves the row while the platform is still unknown (first
          client render), so the cards below do not jump when it resolves. */}
      <div style={{ marginTop: 16, minHeight: 44 }}>
        {platform === 'installed' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, minHeight: 44 }}>
            <Icon name="success" size={20} color="var(--color-success)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t.pwa.installedTitle}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.pwa.installedDesc}</div>
            </div>
          </div>
        )}

        {platform === 'unsupported' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12 }}>
            <Icon name="info" size={20} color="var(--color-info)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t.pwa.unsupportedTitle}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{t.pwa.unsupportedDesc}</div>
            </div>
          </div>
        )}

        {/* Mounted from the start and filled in later: a live region that is
            inserted together with its text is not announced by most screen readers. */}
        <div role="status">
          {dismissed && showGuide && (
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t.pwa.installDismissed}
            </p>
          )}
        </div>

        {showGuide && platform !== 'unsupported' && platform !== 'chromium-prompt' && (
          <p style={{ margin: '0 0 12px', fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
            {t.pwa.guide.subtitle}
          </p>
        )}

        {showGuide && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {platform === 'chromium-prompt' && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => { prompted.current = true; void run(); }}
                disabled={pending}
                aria-busy={pending || undefined}
                style={{ minHeight: 44, cursor: pending ? 'progress' : 'pointer' }}
              >
                {pending
                  ? <span className="spinner" aria-hidden style={{ width: 16, height: 16 }} />
                  : <Icon name="download" size={18} />}
                {pending ? t.pwa.installWaiting : t.pwa.installButton}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setGuideOpen(true)}
              disabled={pending}
              aria-haspopup="dialog"
              style={{ minHeight: 44, whiteSpace: 'normal', textAlign: 'left' }}
            >
              <Icon name="info" size={18} />
              {t.pwa.guide.openButton}
            </button>
          </div>
        )}
      </div>

      {guideOpen && <InstallGuideDialog initialPlatform={guide} onClose={() => setGuideOpen(false)} />}
    </section>
  );
}

/**
 * Login-screen install entry — where a freshly unboxed tablet lands. One quiet
 * text button under the form that opens the illustrated install guide (with an
 * "install now" shortcut inside when the browser offers one). Renders nothing
 * once the app is installed.
 */
export function InstallEntry() {
  const { t } = useI18n();
  const { platform, guide } = useInstallPrompt();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Installed from inside the dialog: the link that opened it is gone, so the
  // dialog's focus restore has no target and focus would fall to <body>. Land on
  // the first control of the surrounding login card instead.
  const close = () => {
    const scope = platform === 'installed' ? rootRef.current?.parentElement : null;
    setOpen(false);
    if (scope) {
      requestAnimationFrame(() => {
        const active = document.activeElement;
        if (!active || active === document.body) scope.querySelector<HTMLElement>('input, button, a[href]')?.focus();
      });
    }
  };

  // Keep the dialog mounted if the app gets installed from inside it, so the
  // success message stays readable until the user closes it.
  if (!open && (platform === 'unknown' || platform === 'installed')) return null;

  return (
    <div ref={rootRef} style={{ marginTop: 'var(--space-5)', textAlign: 'center' }}>
      {platform !== 'installed' && (
        <button type="button" className="btn-link" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          <Icon name="download" size={16} />
          {t.pwa.loginEntry}
        </button>
      )}
      {open && <InstallGuideDialog initialPlatform={guide} onClose={close} />}
    </div>
  );
}
