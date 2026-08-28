'use client';

import { useId, type ReactNode } from 'react';
import { Tag } from '@/components/ui/tag';
import { Mono } from '@/components/ui/layout-bits';
import type { FeatureOption } from '@/lib/feature-registry';

interface FeaturePickerProps {
  legend: string;
  hint?: ReactNode;
  error?: string;
  value: string[];
  options: FeatureOption[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

/**
 * Checkbox group for a package's feature keys.
 *
 * Deliberately not built on `Field`: that shell puts `htmlFor` on a single label
 * and assumes one labelable control, which a checkbox group is not. This mirrors
 * its hint/error markup and aria wiring with a fieldset/legend instead.
 */
export function FeaturePicker({
  legend, hint, error, value, options, onChange, disabled,
}: FeaturePickerProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;

  // Rebuild from `options` rather than from the incoming array so the emitted
  // order is stable — the confirm-phase diff on the packages page compares lists.
  const toggle = (key: string) => {
    const set = new Set(value);
    if (set.has(key)) set.delete(key);
    else set.add(key);
    onChange(options.filter((o) => set.has(o.key)).map((o) => o.key));
  };

  return (
    <fieldset
      aria-describedby={describedBy}
      style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}
    >
      <legend style={{ padding: 0, fontSize: 'var(--fs-13)', fontWeight: 'var(--fw-semibold)', color: 'var(--color-text)' }}>
        {legend}
      </legend>

      <div
        style={{
          border: `1px solid ${error ? 'var(--color-danger-fg)' : 'var(--color-border)'}`,
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-2)',
          display: 'flex', flexDirection: 'column', gap: 2,
        }}
      >
        {options.map((o) => (
          <label
            key={o.key}
            style={{
              display: 'flex', gap: 10, alignItems: 'flex-start',
              padding: 'var(--space-2)',
              borderRadius: 'var(--radius-md)',
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={value.includes(o.key)}
              disabled={disabled}
              onChange={() => toggle(o.key)}
              style={{ width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
            />
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 'var(--fw-medium)', fontSize: 'var(--fs-13)' }}>
                {o.label}
                {!o.known && (
                  <span style={{ marginInlineStart: 6 }}>
                    <Tag tone="warning">ไม่รู้จักในเวอร์ชันนี้</Tag>
                  </span>
                )}
              </span>
              <Mono>{o.key}</Mono>
              {!o.known && (
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  คีย์นี้มีอยู่บนแพ็กเกจแล้วแต่ยังไม่มีในรายการของหน้านี้ — ติ๊กไว้เพื่อคงไว้
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      {hint && (
        <p id={hintId} style={{ fontSize: 'var(--fs-12)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          {hint}
        </p>
      )}
      {error && (
        <p id={errId} style={{ fontSize: 'var(--fs-12)', color: 'var(--color-danger-fg)', fontWeight: 'var(--fw-medium)' }}>
          {error}
        </p>
      )}
    </fieldset>
  );
}
