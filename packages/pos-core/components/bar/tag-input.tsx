'use client';

import { useId, useState } from 'react';
import Icon from '../icons';
import { MAX_TAGS, MAX_TAG_LENGTH, TAG_ERROR_TEXT, addTag, splitTagInput, type TagError } from '@pos/core/lib/table-ordering/tags';

/**
 * Chip input for product tags on the guest menu. Enter or comma adds, a paste of
 * "a, b, c" adds each, Backspace on an empty field removes the last chip. Every
 * refusal (blank, too long, duplicate, too many) is announced, not silent.
 */
export function TagInput({ id, value, onChange }: { id?: string; value: string[]; onChange: (tags: string[]) => void }) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const msgId = `${inputId}-msg`;
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<TagError | null>(null);

  const commit = (raw: string) => {
    let tags = value;
    let lastError: TagError | null = null;
    for (const part of splitTagInput(raw)) {
      if (!part.trim()) continue;
      const r = addTag(tags, part);
      if (r.error) lastError = r.error; else tags = r.tags;
    }
    if (!raw.trim()) lastError = 'blank';
    if (tags !== value) onChange(tags);
    setError(lastError);
    if (!lastError || tags !== value) setDraft('');
  };

  const remove = (i: number) => { onChange(value.filter((_, j) => j !== i)); setError(null); };
  const full = value.length >= MAX_TAGS;

  return (
    <div>
      <style>{TAG_CSS}</style>
      <div className="tag-box" onClick={() => document.getElementById(inputId)?.focus()}>
        {value.map((t, i) => (
          <span key={`${t}-${i}`} className="tag-chip">
            <span className="tag-chip-text">{t}</span>
            <button type="button" className="tag-x" aria-label={`ลบแท็ก ${t}`} onClick={(e) => { e.stopPropagation(); remove(i); }}>
              <Icon name="x" size={14} />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          disabled={full}
          maxLength={MAX_TAG_LENGTH + 10}
          placeholder={full ? `ครบ ${MAX_TAGS} แท็กแล้ว` : value.length ? 'เพิ่มแท็ก…' : 'เช่น สดชื่น, ความแรง: กลาง'}
          aria-describedby={msgId}
          onChange={(e) => {
            const v = e.target.value;
            if (v.includes(',')) { commit(v); return; }
            setDraft(v);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
            else if (e.key === 'Backspace' && !draft && value.length) remove(value.length - 1);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData('text');
            if (/[,\n]/.test(text)) { e.preventDefault(); commit(draft + text); }
          }}
          onBlur={() => { if (draft.trim()) commit(draft); }}
          className="tag-field"
        />
      </div>
      <div id={msgId} className="tag-msg" data-error={error ? '' : undefined} aria-live="polite">
        {error ? TAG_ERROR_TEXT[error] : `กด Enter หรือจุลภาคเพื่อเพิ่ม · ${value.length}/${MAX_TAGS} แท็ก · ยาวไม่เกิน ${MAX_TAG_LENGTH} ตัวอักษร`}
      </div>
    </div>
  );
}

const TAG_CSS = `
.tag-box { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; min-height: 44px; padding: 6px 8px; border: 1px solid var(--color-border); border-radius: 8px; background: var(--color-surface); cursor: text; box-sizing: border-box; }
.tag-box:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--color-primary) 20%, transparent); }
.tag-chip { display: inline-flex; align-items: center; gap: 2px; padding: 2px 2px 2px 10px; border-radius: 999px; background: var(--color-surface-2); border: var(--hairline); font-size: 13px; font-weight: 600; max-width: 100%; }
.tag-chip-text { overflow-wrap: anywhere; }
.tag-x { display: inline-grid; place-items: center; width: 28px; height: 28px; min-height: 28px; border: 0; border-radius: 999px; background: transparent; color: var(--color-text-secondary); cursor: pointer; padding: 0; }
.tag-x:focus-visible { outline: 2px solid var(--color-focus-ring); }
@media (hover: hover) and (pointer: fine) { .tag-x:hover { background: var(--color-border); color: var(--color-text); } }
.tag-field { flex: 1; min-width: 140px; border: 0 !important; outline: none !important; box-shadow: none !important; min-height: 32px !important; background: transparent !important; font: inherit; font-size: 14px; padding: 6px 4px; color: var(--color-text); }
.tag-msg { margin-top: 6px; font-size: 12px; color: var(--color-text-secondary); }
.tag-msg[data-error] { color: var(--color-danger-fg); font-weight: 600; }
@media (any-pointer: coarse) { .tag-x { width: 44px; height: 44px; min-height: 44px; } .tag-chip { padding-left: 12px; } }
@media (max-width: 767px) { .tag-field { font-size: 16px; } }
`;
