'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from '../icons';
import { ModalShell, useToast } from '../app-common';
import { Skeleton } from '@pos/core/components/ui/skeleton';
import { ApiError } from '@pos/core/lib/api-client';
import { qrDataUrl, useReissueTableQr, useTableQr, useTableQrs, type TableQr } from '@pos/core/hooks/use-table-qr';

/**
 * Table QR stickers: one table's QR (with reissue for OWNER / MANAGER) and a
 * print sheet for every table. `url` / PNG are null until FRD sets the store's
 * guest site URL — both views explain that instead of showing a broken image.
 */

interface TableRef { id: string; name: string; zone?: string | null }

const NO_URL_TITLE = 'ยังไม่ได้ตั้งค่าเว็บสั่งอาหารของร้าน';
const NO_URL_BODY = 'QR จะใช้ได้เมื่อ FRD ตั้งค่า URL เว็บสั่งอาหาร (guest site URL) ให้ร้านนี้แล้ว — ติดต่อทีม FRD';

function qrError(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return 'ดู QR โต๊ะได้เฉพาะเจ้าของร้านและผู้จัดการ';
  if (e instanceof ApiError && e.status === 404) return 'ไม่พบโต๊ะนี้ หรือร้านยังไม่ได้เปิดใช้การสั่งผ่าน QR';
  return e instanceof Error ? e.message : 'โหลด QR ไม่สำเร็จ';
}

// ── One table ────────────────────────────────────────────────────────────────
export function TableQrModal({ table, canReissue, onClose }: { table: TableRef; canReissue: boolean; onClose: () => void }) {
  const toast = useToast();
  const qrQ = useTableQr(table.id);
  const reissue = useReissueTableQr();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doReissue = async () => {
    setError(null);
    try {
      await reissue.mutateAsync(table.id);
      setConfirming(false);
      toast({ kind: 'success', title: `ออก QR ใหม่ให้โต๊ะ ${table.name} แล้ว`, msg: 'พิมพ์สติกเกอร์ใหม่แล้วแปะแทนอันเดิม' });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 403 ? 'ออก QR ใหม่ได้เฉพาะเจ้าของร้านและผู้จัดการ' : qrError(e));
    }
  };

  const qr = qrQ.data;
  return (
    <ModalShell
      title={`QR โต๊ะ ${table.name}`}
      subtitle="ลูกค้าสแกนเพื่อเปิดเมนูและสั่งเอง"
      onClose={onClose}
      busy={reissue.isPending}
      width={460}
      footer={canReissue && !confirming ? (
        <button className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }} onClick={() => setConfirming(true)} disabled={!qr}>
          <Icon name="refresh" size={18} /> ออก QR ใหม่
        </button>
      ) : undefined}
    >
      <style>{QR_CSS}</style>
      {qrQ.isLoading && <Skeleton height={260} radius="var(--radius-lg)" />}
      {qrQ.isError && <div role="alert" className="qr-alert" data-tone="danger">{qrError(qrQ.error)}</div>}
      {qr && <QrFace qr={qr} size="lg" />}

      {confirming && (
        <div className="qr-alert" data-tone="warning" role="alertdialog" aria-label="ยืนยันออก QR ใหม่" style={{ marginTop: 'var(--space-4)' }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>สติกเกอร์อันเดิมจะสแกนไม่ได้ทันที</strong>
          ใช้เมื่อ QR ถูกถ่ายรูปไปหรือมีคนแอบสั่ง — แขกที่นั่งอยู่ตอนนี้ยังสั่งต่อได้จนปิดโต๊ะ
          <div style={{ display: 'flex', gap: 'var(--tap-gap)', marginTop: 'var(--space-3)' }}>
            <button className="btn btn-ghost tap-lg" style={{ flex: 1 }} onClick={() => setConfirming(false)} disabled={reissue.isPending}>ยกเลิก</button>
            <button className="btn btn-danger tap-lg" style={{ flex: 1.4 }} onClick={() => { void doReissue(); }} disabled={reissue.isPending}>
              {reissue.isPending ? <span className="spinner" style={{ width: 18, height: 18 }} aria-hidden /> : 'ยืนยัน ออก QR ใหม่'}
            </button>
          </div>
        </div>
      )}
      {error && <div role="alert" className="qr-alert" data-tone="danger" style={{ marginTop: 'var(--space-3)' }}>{error}</div>}
    </ModalShell>
  );
}

function QrFace({ qr, size }: { qr: TableQr; size: 'lg' | 'sm' }) {
  if (!qr.url || !qr.pngBase64) {
    return (
      <div className="qr-face" data-size={size} data-missing>
        <div className="qr-name">{qr.tableName}</div>
        <div className="qr-missing">
          <Icon name="link" size={20} />
          <strong>{NO_URL_TITLE}</strong>
          <span>{NO_URL_BODY}</span>
        </div>
      </div>
    );
  }
  return (
    <div className="qr-face" data-size={size}>
      <div className="qr-name">{qr.tableName}</div>
      {/* data: URL — the CSP allows img-src data: (PromptPay QRs use it too). */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qrDataUrl(qr.pngBase64)} alt={`QR สั่งอาหาร โต๊ะ ${qr.tableName}`} className="qr-img" />
      <div className="qr-cta"><span>สแกนเพื่อสั่งเครื่องดื่ม</span><span lang="en" className="qr-cta-en">Scan to order</span></div>
      <div className="qr-url">{qr.url}</div>
    </div>
  );
}

// ── Print sheet ──────────────────────────────────────────────────────────────
export function QrPrintSheet({ tables, onClose }: { tables: readonly TableRef[]; onClose: () => void }) {
  const results = useTableQrs(tables.map((t) => t.id), true);
  const loading = results.some((r) => r.isLoading);
  const qrs = results.map((r) => r.data).filter((q): q is TableQr => !!q);
  const failed = results.filter((r) => r.isError);
  const missingUrl = qrs.filter((q) => !q.url || !q.pngBase64).length;
  const printable = qrs.filter((q) => q.url && q.pngBase64);

  return (
    <ModalShell
      title="พิมพ์ QR ทุกโต๊ะ"
      subtitle={loading ? 'กำลังโหลด QR…' : `${printable.length} จาก ${tables.length} โต๊ะพร้อมพิมพ์ · A4 หน้าละ 6 ใบ`}
      onClose={onClose}
      width={920}
      footer={<>
        <button className="btn btn-ghost btn-lg tap-lg" style={{ flex: 1 }} onClick={onClose}>ปิด</button>
        <button className="btn btn-primary btn-lg tap-lg" style={{ flex: 1.6 }} onClick={() => window.print()} disabled={loading || printable.length === 0}>
          <Icon name="print" size={18} /> พิมพ์ {printable.length} ใบ
        </button>
      </>}
    >
      <style>{QR_CSS}</style>
      {missingUrl > 0 && (
        <div className="qr-alert" data-tone="warning" role="status" style={{ marginBottom: 'var(--space-4)' }}>
          <strong style={{ display: 'block', marginBottom: 4 }}>{NO_URL_TITLE}</strong>{NO_URL_BODY}
        </div>
      )}
      {failed.length > 0 && (
        <div className="qr-alert" data-tone="danger" role="alert" style={{ marginBottom: 'var(--space-4)' }}>
          โหลด QR ไม่ได้ {failed.length} โต๊ะ — {qrError(failed[0].error)}
        </div>
      )}
      <div className="qr-grid">
        {tables.map((t, i) => {
          const q = results[i]?.data;
          return q ? <QrFace key={t.id} qr={q} size="sm" /> : <Skeleton key={t.id} height={250} radius="var(--radius-lg)" />;
        })}
      </div>
      {typeof document !== 'undefined' && createPortal(
        <div className="qr-print-root" aria-hidden>
          <style>{PRINT_CSS}</style>
          {chunk(printable, 6).map((page, pi) => (
            <div key={pi} className="qr-print-page">
              {page.map((q) => <QrFace key={q.tableId} qr={q} size="lg" />)}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ModalShell>
  );
}

function chunk<T>(list: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

const QR_CSS = `
.qr-alert { padding: 12px 14px; border-radius: var(--radius-md); font-size: var(--fs-sm); line-height: 1.55; }
.qr-alert[data-tone='warning'] { background: var(--color-warning-50); color: var(--color-warning-fg); }
.qr-alert[data-tone='danger'] { background: var(--color-danger-50); color: var(--color-danger-fg); font-weight: 600; }
.qr-face { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 20px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: #fff; color: #1a1a1a; text-align: center; }
.qr-name { font-size: 28px; font-weight: 800; letter-spacing: -0.01em; line-height: 1.1; }
.qr-face[data-size='sm'] .qr-name { font-size: 22px; }
.qr-img { width: 220px; height: 220px; image-rendering: pixelated; }
.qr-face[data-size='sm'] .qr-img { width: 150px; height: 150px; }
.qr-cta { display: flex; flex-direction: column; font-size: 15px; font-weight: 700; line-height: 1.35; }
.qr-cta-en { font-weight: 500; font-size: 13px; color: #5b5b5b; }
.qr-url { font-size: 12px; color: #5b5b5b; overflow-wrap: anywhere; max-width: 100%; }
.qr-missing { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 18px 8px; font-size: var(--fs-sm); line-height: 1.5; color: var(--color-warning-fg); }
.qr-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
`;

/* Print: only the sheet. ModalShell + the app are portaled siblings in <body>. */
const PRINT_CSS = `
.qr-print-root { display: none; }
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body > *:not(.qr-print-root) { display: none !important; }
  .qr-print-root { display: block !important; }
  .qr-print-page { display: grid; grid-template-columns: 1fr 1fr; grid-auto-rows: 88mm; gap: 6mm; break-after: page; }
  .qr-print-page:last-child { break-after: auto; }
  .qr-print-root .qr-face { border: 1px dashed #999; border-radius: 4mm; justify-content: center; padding: 4mm; break-inside: avoid; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .qr-print-root .qr-img { width: 56mm; height: 56mm; }
  .qr-print-root .qr-name { font-size: 26pt; }
  .qr-print-root .qr-cta { font-size: 12pt; }
  .qr-print-root .qr-url { font-size: 8pt; }
}
`;
