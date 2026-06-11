'use client';

import Icon from '../icons';
import { Tag } from '../app-common';
import { useI18n, type Lang } from '@/lib/i18n';

export default function Settings() {
  const { t, lang, setLang } = useI18n();

  const langOptions: { value: Lang; label: string; sub: string }[] = [
    { value: 'th', label: t.settings.thai, sub: 'ภาษาไทย' },
    { value: 'en', label: t.settings.english, sub: 'English' },
  ];

  const infoCards = [
    { icon: 'inv', title: t.settings.storeInfoTitle, desc: t.settings.storeInfoDesc },
    { icon: 'printer', title: t.settings.devicesTitle, desc: t.settings.devicesDesc },
    { icon: 'tag', title: t.settings.integrationTitle, desc: t.settings.integrationDesc },
    { icon: 'reports', title: t.settings.backupTitle, desc: t.settings.backupDesc },
  ];

  return (
    <div className="scroll" style={{ height: '100%', overflow: 'auto', padding: 24, background: 'var(--color-bg)' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>{t.settings.title}</h1>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginTop: 4 }}>{t.settings.subtitle}</div>
      </div>

      {/* Language — the one functional section */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 24, marginBottom: 16, maxWidth: 560 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--color-accent-50)', color: 'var(--color-primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="settings" size={20} />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{t.settings.languageTitle}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{t.settings.languageDesc}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          {langOptions.map((opt) => {
            const active = lang === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => setLang(opt.value)}
                aria-pressed={active}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  padding: '14px 16px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  border: `1.5px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
                  background: active ? 'var(--color-accent-50)' : 'var(--color-surface)',
                  transition: 'border-color 150ms, background 150ms',
                }}
              >
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: active ? 'var(--color-primary-700)' : 'var(--color-text)' }}>{opt.label}</div>
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{opt.sub}</div>
                </div>
                <div style={{
                  width: 20, height: 20, borderRadius: 999, flexShrink: 0,
                  border: `2px solid ${active ? 'var(--color-primary)' : 'var(--color-border-strong)'}`,
                  background: active ? 'var(--color-primary)' : 'transparent',
                  display: 'grid', placeItems: 'center',
                }}>
                  {active && <Icon name="check" size={12} color="#fff" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Everything else — informational, not yet built */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, maxWidth: 1140 }}>
        {infoCards.map((c, i) => (
          <div key={i} style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border-strong)', borderRadius: 12, padding: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ width: 36, height: 36, borderRadius: 9, background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', display: 'grid', placeItems: 'center' }}>
                <Icon name={c.icon} size={18} />
              </div>
              <Tag tone="warning">{t.settings.comingSoon}</Tag>
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>{c.title}</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{c.desc}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
