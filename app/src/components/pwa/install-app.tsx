'use client';

import { useEffect, useId, useRef, useState } from 'react';
import Icon from '../icons';
import { useI18n } from '@/lib/i18n';
import { useInstallPrompt, type InstallOutcome, type InstallPlatform } from '@/hooks/use-install-prompt';

type ManualPlatform = Extract<InstallPlatform, 'ios' | 'macos-safari' | 'browser-menu'>;

function isManual(platform: InstallPlatform): platform is ManualPlatform {
  return platform === 'ios' || platform === 'macos-safari' || platform === 'browser-menu';
}

/** Numbered "how to install" steps for platforms with no programmatic prompt. */
function InstallSteps({ platform, labelledBy }: { platform: ManualPlatform; labelledBy?: string }) {
  const { t } = useI18n();
  const steps =
    platform === 'ios' ? t.pwa.iosSteps :
    platform === 'macos-safari' ? t.pwa.macSafariSteps :
    t.pwa.browserMenuSteps;

  return (
    <ol
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : t.pwa.stepsLabel}
      style={{
        // Tailwind's preflight strips list markers; the numbers are the point here.
        margin: 0, paddingLeft: 22, listStyle: 'decimal',
        display: 'flex', flexDirection: 'column', gap: 6,
        fontSize: 14, lineHeight: 1.6, color: 'var(--color-text)',
        textAlign: 'left',
      }}
    >
      {steps.map((step) => <li key={step} style={{ paddingLeft: 4 }}>{step}</li>)}
    </ol>
  );
}

/** Shared button + prompt state for the `chromium-prompt` platform. */
function useInstallAction() {
  const { platform, promptInstall } = useInstallPrompt();
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<InstallOutcome | null>(null);

  const run = async () => {
    if (pending) return;
    setPending(true);
    const result = await promptInstall();
    setOutcome(result);
    setPending(false);
  };

  return { platform, pending, dismissed: outcome === 'dismissed', run };
}

/**
 * Settings → "Install app". Mirrors the Language / Appearance cards and shows the
 * one action that works on this device: a real install button where the browser
 * offers one, numbered steps where it does not, and a plain pointer to a capable
 * browser otherwise.
 */
export function InstallCard() {
  const { t } = useI18n();
  const { platform, pending, dismissed, run } = useInstallAction();
  const titleId = useId();
  const stepsHeadingId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const prompted = useRef(false);

  // The install button unmounts as soon as the native dialog resolves (the
  // platform becomes `installed` or falls back to the manual steps), which would
  // drop keyboard focus to <body>. Park it on the card instead, so the next Tab
  // continues from here and a screen reader lands on the result.
  useEffect(() => {
    if (!prompted.current || platform === 'chromium-prompt') return;
    prompted.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) sectionRef.current?.focus({ preventScroll: true });
  }, [platform]);

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={titleId}
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

        {/* Mounted from the start and filled in later: a live region that is
            inserted together with its text is not announced by most screen readers. */}
        <div role="status">
          {dismissed && isManual(platform) && (
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {t.pwa.installDismissed}
            </p>
          )}
        </div>

        {isManual(platform) && (
          <>
            <h3 id={stepsHeadingId} style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700 }}>{t.pwa.stepsLabel}</h3>
            <InstallSteps platform={platform} labelledBy={stepsHeadingId} />
          </>
        )}

        {platform === 'unsupported' && (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Icon name="info" size={20} color="var(--color-info)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t.pwa.unsupportedTitle}</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{t.pwa.unsupportedDesc}</div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/**
 * Login-screen install entry — where a freshly unboxed tablet lands. One quiet
 * text button under the form: it opens the native dialog where available, and
 * otherwise discloses the steps inline (no modal). Renders nothing once the app
 * is installed.
 */
export function InstallEntry() {
  const { t } = useI18n();
  const { platform, pending, run } = useInstallAction();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (platform === 'unknown' || platform === 'installed') return null;

  const canPrompt = platform === 'chromium-prompt';

  return (
    <div style={{ marginTop: 'var(--space-5)', textAlign: 'center' }}>
      <button
        type="button"
        className="btn-link"
        onClick={() => { if (canPrompt) void run(); else setOpen((v) => !v); }}
        disabled={pending}
        aria-busy={pending || undefined}
        aria-expanded={canPrompt ? undefined : open}
        aria-controls={canPrompt ? undefined : panelId}
      >
        <Icon name="download" size={16} />
        {pending ? t.pwa.installWaiting : t.pwa.loginEntry}
        {!canPrompt && (
          <Icon name="chevronDown" size={14} style={{
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform var(--dur-base) var(--ease-out)',
          }} />
        )}
      </button>

      {!canPrompt && (
        <div id={panelId} hidden={!open} style={{ marginTop: 'var(--space-2)' }}>
          <div style={{
            padding: 'var(--space-4)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            textAlign: 'left',
          }}>
            {isManual(platform)
              ? <InstallSteps platform={platform} />
              : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{t.pwa.unsupportedTitle}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{t.pwa.unsupportedDesc}</div>
                </>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
