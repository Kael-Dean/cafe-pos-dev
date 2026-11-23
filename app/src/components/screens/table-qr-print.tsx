'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../icons';
import { ModalShell, useToast } from '../app-common';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser, isAdmin } from '@/hooks/use-current-user';
import { useSelfOrderingEnabled } from '@/hooks/use-features';
import { useFloorTables } from '@/hooks/use-floor';
import { useReissueTableQr, useTableQrs, type TableQr } from '@/hooks/use-self-ordering';
import { describeError } from '@/lib/self-ordering';

type QrState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; qr: TableQr };

/**
 * Print sheet for the fixed table stickers: GET /floor/tables/{id}/qr for every table.
 * OWNER / MANAGER only (the API enforces it too). `url` / `qr_png_base64` come back null
 * until FRD has set the store's guest_app_url — that is shown as a setup hint, not an error.
 */
export default function TableQrPrint() {
  const toast = useToast();
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const admin = isAdmin(me?.role);
  const { enabled, isLoading: featureLoading } = useSelfOrderingEnabled();
  const tablesQ = useFloorTables(false, enabled && admin);
  const tables = useMemo(() => tablesQ.data ?? [], [tablesQ.data]);
  const qrQs = useTableQrs(tables.map((t) => t.id), enabled && admin);
  const reissue = useReissueTableQr();

  const [confirm, setConfirm] = useState<{ id: string; name: string } | null>(null);
  const [reissueError, setReissueError] = useState<string | null>(null);
  const [printTarget, setPrintTarget] = useState<string | 'all' | null>(null);

  const stateOf = (i: number): QrState => {
    const q = qrQs[i];
    if (!q || q.isLoading) return { kind: 'loading' };
    if (q.isError || !q.data) return { kind: 'error', message: describeError(q.error, 'reissue') };
    return { kind: 'ready', qr: q.data };
  };

  // Open the browser print dialog once the print-only sheet has rendered for the target.
  useEffect(() => {
    if (!printTarget) return;
    const done = () => setPrintTarget(null);
    window.addEventListener('afterprint', done, { once: true });
    const id = window.setTimeout(() => window.print(), 150);
    return () => { window.clearTimeout(id); window.removeEventListener('afterprint', done); };
  }, [printTarget]);

  if (featureLoading || meLoading) {
    return (
      <div className="screen-pad-lg" aria-busy="true" style={{ padding: 'var(--space-8)' }}>
        <span className="sr-only">กำลังโหลด…</span>
        <Skeleton height={28} width={260} radius="var(--radius-md)" style={{ marginBottom: 'var(--space-6)' }} />
        <Skeleton height={260} radius="var(--radius-lg)" />
      </div>
    );
  }
  if (!enabled) return <Notice title="ร้านนี้ยังไม่ได้เปิดระบบสั่งผ่าน QR" body="ฟีเจอร์ self_ordering ยังไม่ได้เปิดให้ร้านนี้" />;
  if (!admin) return <Notice title="เฉพาะเจ้าของและผู้จัดการ" body="การพิมพ์และออกรหัส QR ใหม่ทำได้เฉพาะเจ้าของ/ผู้จัดการ" />;

  const states = tables.map((_, i) => stateOf(i));
  const anyUrlMissing = states.some((s) => s.kind === 'ready' && (!s.qr.url || !s.qr.qr_png_base64));
  const printable = tables
    .map((t, i) => ({ t, s: states[i] }))
    .filter((x): x is { t: (typeof tables)[number]; s: { kind: 'ready'; qr: TableQr } } => x.s.kind === 'ready' && !!x.s.qr.qr_png_base64 && !!x.s.qr.url);

  const doReissue = async () => {
    if (!confirm || reissue.isPending) return;
    setReissueError(null);
    try {
      await reissue.mutateAsync(confirm.id);
      toast({ kind: 'success', title: `ออก QR ใหม่ให้โต๊ะ ${confirm.name} แล้ว`, msg: 'พิมพ์สติกเกอร์ใหม่ไปติดแทนอันเดิม' });
      setConfirm(null);
    } catch (e) {
      setReissueError(describeError(e, 'reissue'));
    }
  };

  const sheet = printTarget
    ? printable.filter((x) => printTarget === 'all' || x.t.id === printTarget)
    : [];

  return (
    <div className="screen-pad-lg" style={{ padding: 'var(--space-6)', maxWidth: 1200, margin: '0 auto' }}>
      <style>{QR_CSS}</style>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 className="text-balance" style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>QR ประจำโต๊ะ</h1>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
            พิมพ์แล้วติดที่โต๊ะ — ลูกค้าสแกนเพื่อสั่งเอง ทุกโต๊ะใช้ QR ตายตัวของตัวเอง
          </div>
        </div>
        <button onClick={() => setPrintTarget('all')} disabled={printable.length === 0} className="btn btn-primary tap-lg">
          <Icon name="print" size={20} /> พิมพ์ทั้งหมด ({printable.length})
        </button>
      </header>

      {anyUrlMissing && (
        <div role="alert" style={{ display: 'flex', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', background: 'var(--color-warning-50)', color: 'var(--color-warning-fg)', fontWeight: 600, marginBottom: 'var(--space-4)' }}>
          <Icon name="warning" size={20} />
          <span>ยังไม่ได้ตั้งที่อยู่เว็บสั่งอาหารของลูกค้า (guest_app_url) ของร้านนี้ จึงยังไม่มี QR — ให้ผู้ดูแลระบบ (FRD) ตั้งค่าที่ร้านก่อน แล้วกลับมารีเฟรชหน้านี้</span>
        </div>
      )}

      {tablesQ.isLoading && <div aria-busy="true" className="qr-grid"><span className="sr-only">กำลังโหลดโต๊ะ…</span>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={300} radius="var(--radius-lg)" />)}</div>}
      {tablesQ.isError && (
        <div role="alert" style={{ color: 'var(--color-danger-fg)', fontWeight: 600 }}>
          โหลดรายชื่อโต๊ะไม่สำเร็จ — {describeError(tablesQ.error, 'reissue')}
          <button onClick={() => { void tablesQ.refetch(); }} className="btn btn-ghost tap-std" style={{ marginLeft: 12 }}>ลองอีกครั้ง</button>
        </div>
      )}
      {tablesQ.data && tables.length === 0 && <Notice title="ยังไม่มีโต๊ะ" body="สร้างโต๊ะที่หน้า “ตั้งค่าโต๊ะ” ก่อน" />}

      <div className="qr-grid">
        {tables.map((t, i) => {
          const s = states[i];
          return (
            <article key={t.id} className="qr-card" aria-label={`QR โต๊ะ ${t.name}`}>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{t.name}</div>
              {s.kind === 'loading' && <Skeleton height={180} width={180} radius="var(--radius-md)" />}
              {s.kind === 'error' && (
                <div role="alert" style={{ color: 'var(--color-danger-fg)', fontSize: 'var(--fs-sm)', fontWeight: 600 }}>
                  โหลด QR ไม่สำเร็จ — {s.message}
                </div>
              )}
              {s.kind === 'ready' && (!s.qr.url || !s.qr.qr_png_base64) && (
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--color-warning-fg)', fontWeight: 600, lineHeight: 1.5 }}>
                  ยังไม่ได้ตั้ง guest_app_url ของร้าน — ยังไม่มี QR ให้พิมพ์
                </div>
              )}
              {s.kind === 'ready' && s.qr.url && s.qr.qr_png_base64 && (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element -- inline base64 PNG from the API */}
                  <img
                    src={`data:image/png;base64,${s.qr.qr_png_base64}`}
                    alt={`QR สำหรับโต๊ะ ${t.name}`}
                    width={180}
                    height={180}
                    style={{ background: '#fff', padding: 6, borderRadius: 8, imageRendering: 'pixelated' }}
                  />
                  <div style={{ fontSize: 'var(--fs-cap)', color: 'var(--color-text-secondary)', overflowWrap: 'anywhere', textAlign: 'center' }}>{s.qr.url}</div>
                </>
              )}
              <div style={{ display: 'flex', gap: 'var(--tap-gap)', width: '100%', marginTop: 'auto' }}>
                <button
                  onClick={() => setPrintTarget(t.id)}
                  disabled={s.kind !== 'ready' || !s.qr.qr_png_base64}
                  className="btn btn-ghost tap-std"
                  style={{ flex: 1 }}
                  aria-label={`พิมพ์ QR โต๊ะ ${t.name}`}
                >
                  <Icon name="print" size={18} /> พิมพ์
                </button>
                <button
                  onClick={() => { setReissueError(null); setConfirm({ id: t.id, name: t.name }); }}
                  disabled={s.kind !== 'ready'}
                  className="btn btn-ghost tap-std"
                  style={{ flex: 1, color: 'var(--color-danger-fg)' }}
                  aria-label={`ออก QR ใหม่ โต๊ะ ${t.name}`}
                >
                  <Icon name="refresh" size={18} /> ออกใหม่
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {confirm && (
        <ModalShell
          title={`ออก QR ใหม่ให้โต๊ะ ${confirm.name}?`}
          onClose={() => { if (!reissue.isPending) setConfirm(null); }}
          busy={reissue.isPending}
          width={480}
          footer={
            <>
              <button onClick={() => setConfirm(null)} disabled={reissue.isPending} className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }}>ยกเลิก</button>
              <button onClick={() => { void doReissue(); }} disabled={reissue.isPending} className="btn btn-danger btn-lg tap-lg" style={{ flex: 1.5 }}>
                {reissue.isPending ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> : 'ยืนยันออก QR ใหม่'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.7, fontSize: 'var(--fs-body)' }}>
            <strong>สติกเกอร์เดิมของโต๊ะนี้จะใช้ไม่ได้ทันที</strong> — คนที่สแกนอันเก่าจะเห็นว่า QR ไม่ทำงาน
            ต้องพิมพ์อันใหม่ไปติดแทน
          </p>
          <p style={{ margin: '12px 0 0', lineHeight: 1.7, fontSize: 'var(--fs-body)', color: 'var(--color-text-secondary)' }}>
            ลูกค้าที่นั่งอยู่ตอนนี้ยังสั่งต่อได้ตามปกติจนกว่าจะปิดโต๊ะ
          </p>
          {reissueError && <div role="alert" style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-50)', color: 'var(--color-danger-fg)', fontWeight: 600 }}>{reissueError}</div>}
        </ModalShell>
      )}

      {/* Print-only sheet, portaled to <body> so `body > *:not(.qr-print-root)` can hide the app. */}
      {printTarget && typeof document !== 'undefined' && createPortal(
        <div className="qr-print-root" aria-hidden="true">
          {sheet.map(({ t, s }) => (
            <section key={t.id} className="qr-sheet">
              <div className="qr-sheet-name">{t.name}</div>
              {/* eslint-disable-next-line @next/next/no-img-element -- inline base64 PNG from the API */}
              <img src={`data:image/png;base64,${s.qr.qr_png_base64}`} alt="" className="qr-sheet-img" />
              <div className="qr-sheet-hint">สแกนเพื่อสั่งเครื่องดื่ม</div>
              <div className="qr-sheet-url">{s.qr.url}</div>
            </section>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: 'var(--space-8)', maxWidth: 520, margin: '0 auto', textAlign: 'center' }}>
      <div style={{ fontSize: 17, fontWeight: 700 }}>{title}</div>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>{body}</p>
    </div>
  );
}

const QR_CSS = `
.qr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--space-4); }
.qr-card { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); padding: var(--space-4); min-height: 300px;
  background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.qr-print-root { display: none; }
@media print {
  body > *:not(.qr-print-root) { display: none !important; }
  .qr-print-root { display: grid !important; grid-template-columns: 1fr 1fr; gap: 10mm; padding: 10mm; background: #fff; color: #000; }
  .qr-sheet { break-inside: avoid; page-break-inside: avoid; border: 1px dashed #888; padding: 8mm; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 4mm; }
  .qr-sheet-name { font-size: 40pt; font-weight: 800; line-height: 1; }
  .qr-sheet-img { width: 60mm; height: 60mm; image-rendering: pixelated; }
  .qr-sheet-hint { font-size: 14pt; font-weight: 600; }
  .qr-sheet-url { font-size: 8pt; overflow-wrap: anywhere; color: #333; }
}
@media (max-width: 767px) { .qr-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; } }
`;
