'use client';

import { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../icons';
import { cropImageToSquare, type CropState } from '@/lib/image-crop';

/**
 * Square (1:1) image-crop step inserted before a menu photo uploads. The user
 * picks any source image; this lets them pan (drag) and zoom (slider + wheel +
 * two-finger pinch) to frame a square region, then confirm → we hand back a
 * cropped WebP File for the existing upload flow to downscale and store.
 *
 * Geometry model (see image-crop.ts): the image is drawn behind a fixed square
 * window at `natural × scale`, positioned by (offsetX, offsetY) — the image's
 * top-left relative to the window's top-left, both in window pixels. We always
 * clamp so the scaled image fully covers the window (no gaps), and `minScale`
 * is the cover-fit scale (the smallest zoom that still covers).
 *
 * Portal note: screen roots animate in via GSAP (useFadeRise), which leaves an
 * inline `transform` on an ancestor. A non-none transform becomes the containing
 * block for `position: fixed`, trapping this overlay inside the page column
 * instead of the viewport — so we portal to <body>, matching receipt-modal.
 */

const MAX_ZOOM_FACTOR = 4; // allow zooming up to 4× the cover-fit scale

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}

/** Modal a11y: focus into the dialog, Esc to close, restore focus on unmount.
 *  Mirrors the role="dialog"/aria-modal convention used by sibling modals. */
function useModalA11y(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const node = ref.current;

    const focusables = () =>
      Array.from(
        node?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    focusables()[0]?.focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
    };
    // Runs once for the modal's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}

export default function ImageCropModal({ file, onCancel, onConfirm }: Props) {
  const dialogRef = useModalA11y(onCancel);
  const stageRef = useRef<HTMLDivElement>(null);

  // Source image, decoded once for preview + framing.
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [loadErr, setLoadErr] = useState(false);

  // Crop window side in CSS px, measured from the stage element after layout.
  const [cropPx, setCropPx] = useState(0);

  // View-state. scale = image px per source px; offset = image top-left vs window.
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const [saving, setSaving] = useState(false);

  // ── Decode the picked file into an <img> we can read natural dimensions from.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => setLoadErr(true);
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // ── Measure the square window once the stage is laid out (and on resize).
  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setCropPx(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Clamp pan so the scaled image always fully covers the window (no gaps).
  const clampOffset = useCallback((x: number, y: number, s: number) => {
    if (!natural || cropPx === 0) return { x, y };
    const sw = natural.w * s;
    const sh = natural.h * s;
    // offset must satisfy: offset <= 0 and offset + scaled >= cropPx
    const minX = Math.min(0, cropPx - sw);
    const minY = Math.min(0, cropPx - sh);
    return {
      x: Math.min(0, Math.max(minX, x)),
      y: Math.min(0, Math.max(minY, y)),
    };
  }, [natural, cropPx]);

  // ── Initialise to cover-fit, centered, whenever image or window size changes.
  useEffect(() => {
    if (!natural || cropPx === 0) return;
    const fit = cropPx / Math.min(natural.w, natural.h); // cover the square
    setMinScale(fit);
    setScale(fit);
    const sw = natural.w * fit;
    const sh = natural.h * fit;
    setOffset({ x: (cropPx - sw) / 2, y: (cropPx - sh) / 2 });
  }, [natural, cropPx]);

  const maxScale = minScale * MAX_ZOOM_FACTOR;

  // Apply a new zoom while keeping a focal point (in window px) anchored. Used by
  // the wheel, pinch, and slider so zooming feels like it pivots, not drifts.
  const zoomTo = useCallback((nextScale: number, focal?: { x: number; y: number }) => {
    setScale(prev => {
      if (!natural || cropPx === 0) return prev;
      const s = Math.min(maxScale, Math.max(minScale, nextScale));
      if (s === prev) return prev;
      const fx = focal?.x ?? cropPx / 2;
      const fy = focal?.y ?? cropPx / 2;
      setOffset(o => {
        // Keep the source point under the focal pixel fixed: solve for new offset.
        const ratio = s / prev;
        const nx = fx - (fx - o.x) * ratio;
        const ny = fy - (fy - o.y) * ratio;
        return clampOffset(nx, ny, s);
      });
      return s;
    });
  }, [natural, cropPx, minScale, maxScale, clampOffset]);

  // ── Pointer interactions: single-pointer pan, two-pointer pinch zoom.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; scale: number } | null>(null);
  const dragLast = useRef<{ x: number; y: number } | null>(null);

  const localPoint = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!natural) return;
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, localPoint(e));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale };
      dragLast.current = null;
    } else if (pointers.current.size === 1) {
      dragLast.current = localPoint(e);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      zoomTo(pinch.current.scale * (dist / pinch.current.dist), mid);
    } else if (dragLast.current) {
      const dx = p.x - dragLast.current.x;
      const dy = p.y - dragLast.current.y;
      dragLast.current = p;
      setOffset(o => clampOffset(o.x + dx, o.y + dy, scale));
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 1) {
      // Remaining finger continues the pan from its current position.
      dragLast.current = [...pointers.current.values()][0];
    } else if (pointers.current.size === 0) {
      dragLast.current = null;
    }
  };

  // Wheel zoom, anchored at the cursor. Non-passive listener so we can prevent
  // the page from scrolling under the crop surface.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const focal = { x: e.clientX - r.left, y: e.clientY - r.top };
      const factor = Math.exp(-e.deltaY * 0.0015); // smooth multiplicative step
      zoomTo(scale * factor, focal);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scale, zoomTo]);

  const handleConfirm = useCallback(async () => {
    if (saving || !natural || cropPx === 0) return;
    setSaving(true);
    const state: CropState = { scale, offsetX: offset.x, offsetY: offset.y, cropPx };
    try {
      const cropped = await cropImageToSquare(file, state);
      onConfirm(cropped);
    } catch {
      // cropImageToSquare already falls back to the original on failure; if even
      // that throws, hand back the source so the user isn't stuck.
      onConfirm(file);
    }
  }, [saving, natural, cropPx, scale, offset, file, onConfirm]);

  const overlay = (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 320,
        background: 'var(--color-scrim, rgba(26, 16, 8, 0.55))',
        backdropFilter: 'blur(6px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)', overflowY: 'auto',
      }}
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="ครอบตัดรูป"
        aria-busy={saving || undefined}
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 380,
          maxHeight: 'calc(100dvh - (var(--space-4) * 2))',
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl, 16px)',
          boxShadow: 'var(--shadow-lg)',
          display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
          animation: 'modal-in var(--dur-slow) var(--ease-out)',
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: '14px 18px', flexShrink: 0,
          display: 'flex', alignItems: 'center', gap: 10,
          borderBottom: '1px solid var(--color-border)',
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: 'var(--color-primary-50)', color: 'var(--color-primary)',
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="crop" size={16} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>ครอบตัดรูป</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>ลากเพื่อเลื่อน · เลื่อนล้อหรือแถบเพื่อซูม</div>
          </div>
          <button onClick={onCancel} aria-label="ปิด" className="icon-btn hit-44" style={{
            width: 30, height: 30, borderRadius: 6, display: 'grid', placeItems: 'center',
            color: 'var(--color-text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer',
          }}>
            <Icon name="x" size={15} />
          </button>
        </div>

        {/* ── Crop surface ── */}
        <div style={{ padding: 'var(--space-5)', flexShrink: 0 }}>
          <div
            ref={stageRef}
            role="group"
            aria-label="พื้นที่ครอบตัดรูปแบบสี่เหลี่ยมจัตุรัส"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={endPointer}
            style={{
              position: 'relative', width: '100%', aspectRatio: '1 / 1',
              borderRadius: 'var(--radius-lg, 12px)', overflow: 'hidden',
              background: 'var(--color-surface-2)',
              touchAction: 'none', cursor: natural ? 'grab' : 'default',
              userSelect: 'none',
            }}
          >
            {imgUrl && natural && !loadErr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imgUrl}
                alt=""
                draggable={false}
                style={{
                  position: 'absolute', top: 0, left: 0,
                  width: natural.w * scale, height: natural.h * scale,
                  transform: `translate(${offset.x}px, ${offset.y}px)`,
                  maxWidth: 'none', pointerEvents: 'none',
                }}
              />
            )}

            {/* Dim mask: clear inside the (full) square window, dimmed nothing
                else since the window fills the stage. A subtle ring marks the
                exact crop boundary the way Figma/Photoshop frame a selection. */}
            {!loadErr && (
              <div aria-hidden style={{
                position: 'absolute', inset: 0, pointerEvents: 'none',
                boxShadow: 'inset 0 0 0 1px var(--color-border), inset 0 0 0 9999px rgba(0,0,0,0.18)',
              }} />
            )}

            {loadErr && (
              <div style={{
                position: 'absolute', inset: 0, display: 'grid', placeItems: 'center',
                color: 'var(--color-text-muted)', fontSize: 13, padding: 16, textAlign: 'center',
              }}>
                เปิดรูปไม่สำเร็จ กรุณาเลือกรูปอื่น
              </div>
            )}
          </div>

          {/* ── Zoom control ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 'var(--space-4)' }}>
            <Icon name="minus" size={14} aria-hidden />
            <input
              type="range"
              aria-label="ซูม"
              min={0}
              max={1}
              step={0.001}
              value={maxScale > minScale ? (scale - minScale) / (maxScale - minScale) : 0}
              onChange={e => {
                const t = Number(e.target.value);
                zoomTo(minScale + t * (maxScale - minScale));
              }}
              disabled={!natural || loadErr}
              style={{ flex: 1, accentColor: 'var(--color-primary)', cursor: 'pointer' }}
            />
            <Icon name="plus" size={14} aria-hidden />
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div style={{
          borderTop: '1px solid var(--color-border)', padding: 'var(--space-3) var(--space-5)', flexShrink: 0,
          display: 'flex', gap: 'var(--space-2)',
        }}>
          <button
            onClick={onCancel}
            disabled={saving}
            style={{
              flex: 1, minHeight: 44, padding: '8px 14px', borderRadius: 'var(--radius-md, 8px)',
              fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer',
              background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)',
              border: '1px solid var(--color-border)',
            }}
          >
            ยกเลิก
          </button>
          <button
            onClick={handleConfirm}
            disabled={saving || !natural || loadErr}
            aria-busy={saving || undefined}
            style={{
              flex: 2, minHeight: 44, padding: '8px 14px', borderRadius: 'var(--radius-md, 8px)',
              fontSize: 14, fontWeight: 700, fontFamily: 'inherit',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 'var(--space-2)',
              background: (saving || !natural || loadErr) ? 'var(--color-surface-2)' : 'var(--color-primary)',
              color: (saving || !natural || loadErr) ? 'var(--color-text-muted)' : 'var(--color-text-inverse)',
              border: 'none', cursor: (saving || !natural || loadErr) ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? <span className="spinner" aria-hidden style={{ width: 15, height: 15 }} />
              : <Icon name="check" size={15} />}
            ใช้รูปนี้
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : null;
}
