'use client';

import { Input, Kbd } from '@/components/ui';
import { useI18n } from '@/lib/i18n';

interface SearchBarProps {
  value: string;
  onChange: (v: string) => void;
  /** Enter: add the single / highlighted result. */
  onSubmit: () => void;
  /** ↑ / ↓ move the result highlight. */
  onMove: (delta: 1 | -1) => void;
  resultCount: number | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

export function SearchBar({ value, onChange, onSubmit, onMove, resultCount, inputRef }: SearchBarProps) {
  const { t } = useI18n();
  const searching = value.trim() !== '';
  return (
    <div className="pos-search">
      <Input
        ref={inputRef}
        variant="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onClear={() => onChange('')}
        placeholder={t.pos.searchPlaceholder}
        aria-label={t.pos.searchAria}
        aria-keyshortcuts="/ F2"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        trailing={!searching ? <span className="pos-search__kbd" aria-hidden="true"><Kbd>/</Kbd></span> : undefined}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') { e.preventDefault(); onSubmit(); return; }
          if (e.key === 'ArrowDown' && searching) { e.preventDefault(); onMove(1); return; }
          if (e.key === 'ArrowUp' && searching) { e.preventDefault(); onMove(-1); return; }
          if (e.key === 'Escape' && value) { e.preventDefault(); e.stopPropagation(); onChange(''); }
        }}
      />
      <span className="sr-only" role="status" aria-live="polite">
        {searching && resultCount != null ? t.pos.searchResults(resultCount) : ''}
      </span>
    </div>
  );
}
