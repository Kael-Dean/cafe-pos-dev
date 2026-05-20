'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { ReceiptPaper, type ReceiptData, type BuyerInfo, type StoreInfo } from './receipt-modal';

type PrinterStatus = 'online' | 'offline' | 'checking';

/* ── Mock data ────────────────────────────────────────────────────── */

const MOCK_ITEMS = [
  { name: 'ลาเต้เย็น',       qty: 2, unitPrice: 65, mods: ['หวานน้อย', 'นมโอ๊ต'] },
  { name: 'คาปูชิโน่ร้อน',   qty: 1, unitPrice: 55 },
  { name: 'ชีสเค้ก',         qty: 1, unitPrice: 120 },
];
const MOCK_BUYER: BuyerInfo = {
  name: 'บริษัท ตัวอย่าง จำกัด',
  address: '456 ถ.สุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110',
  taxId: '0105500000001',
  branch: 'สำนักงานใหญ่',
};

function makeMockReceipt(): ReceiptData {
  const subtotal = MOCK_ITEMS.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const vat = Math.round(subtotal * 0.07);
  return {
    orderNumber: '0042', items: MOCK_ITEMS,
    subtotal, vat, total: subtotal + vat,
    paymentMethod: 'cash', paymentLabel: 'เงินสด', cashGiven: subtotal + vat + 5,
  };
}

const FMT      = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FMT_DATE = (d: Date)   => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
const FMT_TIME = (d: Date)   => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/* ─────────────────────────────────────────────────────────────────── */

export default function HardwareScreen() {
  const toast = useToast();
  const [printer, setPrinter]     = useState<PrinterStatus>('checking');
  const [printerIp, setPrinterIp] = useState('');
  const [ipInput, setIpInput]     = useState('');
  const [saving, setSaving]       = useState(false);
  const [scanning, setScanning]   = useState(false);
  const [scanResults, setScanResults] = useState<string[]>([]);
  const [testing, setTesting]     = useState(false);
  const [lastPrint, setLastPrint] = useState<string | null>(null);

  const [storeInput, setStoreInput]     = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [taxIdInput, setTaxIdInput]     = useState('');
  const [branchInput, setBranchInput]   = useState('');
  const [savingStore, setSavingStore]   = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewBuyer, setPreviewBuyer] = useState(false);
  const previewNow = useState(() => new Date())[0];

  const liveStore: StoreInfo = {
    name:    storeInput    || 'ชื่อร้านของคุณ',
    address: addressInput  || undefined,
    taxId:   taxIdInput    || undefined,
    branch:  branchInput   || undefined,
  };
  const mockReceipt = makeMockReceipt();
  const invoiceNo   = `IV${previewNow.getFullYear() + 543}${String(previewNow.getMonth() + 1).padStart(2, '0')}${String(previewNow.getDate()).padStart(2, '0')}-0042`;

  /* ── API ── */

  const checkStatus = useCallback(async () => {
    setPrinter('checking');
    try {
      const res  = await fetch('/api/print', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      setPrinter(data.printer ? 'online' : 'offline');
      if (data.ip) { setPrinterIp(data.ip); setIpInput(data.ip); }
    } catch { setPrinter('offline'); }
  }, []);

  useEffect(() => {
    fetch('/api/print/config').then(r => r.json()).then(cfg => {
      setPrinterIp(cfg.ip              ?? '');
      setIpInput(cfg.ip                ?? '');
      setStoreInput(cfg.storeName      ?? '');
      setAddressInput(cfg.storeAddress ?? '');
      setTaxIdInput(cfg.storeTaxId     ?? '');
      setBranchInput(cfg.storeBranch   ?? '');
    });
    checkStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scanPrinters = async () => {
    setScanning(true); setScanResults([]);
    try {
      const res  = await fetch('/api/print/scan', { signal: AbortSignal.timeout(120000) });
      const data = await res.json();
      setScanResults(data.found ?? []);
      if (data.found?.length === 1)  toast({ kind: 'success', title: 'พบเครื่องปริ้น', msg: data.found[0] });
      else if (!data.found?.length)  toast({ kind: 'warning', title: 'ไม่พบเครื่องปริ้น', msg: 'ตรวจสอบว่าเปิดเครื่องและต่อสายแลนอยู่' });
    } catch (err: unknown) {
      toast({ kind: 'warning', title: 'scan ไม่สำเร็จ', msg: (err as Error).message });
    } finally { setScanning(false); }
  };

  const saveIp = async () => {
    const ip = ipInput.trim();
    if (!ip) return;
    setSaving(true);
    try {
      const res = await fetch('/api/print/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setPrinterIp(ip);
      toast({ kind: 'success', title: 'บันทึกแล้ว', msg: `IP: ${ip}` });
      checkStatus();
    } catch (err: unknown) {
      toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg: (err as Error).message });
    } finally { setSaving(false); }
  };

  const saveStoreInfo = async () => {
    const name = storeInput.trim();
    if (!name) return;
    setSavingStore(true);
    try {
      const res = await fetch('/api/print/config', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip: printerIp,
          storeName:    name,
          storeAddress: addressInput.trim() || null,
          storeTaxId:   taxIdInput.trim()   || null,
          storeBranch:  branchInput.trim()  || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ kind: 'success', title: 'บันทึกข้อมูลร้านแล้ว', msg: name });
    } catch (err: unknown) {
      toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg: (err as Error).message });
    } finally { setSavingStore(false); }
  };

  const testPrint = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/print', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderNumber: 'TEST', items: [{ name: 'ทดสอบการพิมพ์', qty: 1, unitPrice: 0 }],
          subtotal: 0, total: 0, paymentLabel: 'ทดสอบ',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setLastPrint(new Date().toLocaleTimeString('th-TH'));
      toast({ kind: 'success', title: 'พิมพ์ทดสอบสำเร็จ', msg: 'ตรวจสอบใบเสร็จที่พิมพ์ออกมา' });
    } catch (err: unknown) {
      toast({ kind: 'warning', title: 'พิมพ์ไม่สำเร็จ', msg: (err as Error).message });
    } finally { setTesting(false); }
  };

  /* ── Render ── */

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '28px 32px' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}} @keyframes spin{to{transform:rotate(360deg)}}`}</style>

      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 3 }}>Hardware / เครื่องพิมพ์</h1>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จัดการเครื่องพิมพ์ใบเสร็จ</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'start' }}>
        {/* Left column: printer + IP */}
        <div>
          {/* Printer status card */}
          <Section title="เครื่องพิมพ์">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <div style={{
                width: 44, height: 44, borderRadius: 10,
                background: 'var(--color-surface-2)', display: 'grid', placeItems: 'center', flexShrink: 0,
              }}>
                <Icon name="printer" size={24} color="var(--color-text-secondary)" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                  <span style={{ fontWeight: 700, fontSize: 14 }}>EPSON TM-T82X</span>
                  <StatusDot s={printer} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  IP: {printerIp || '—'} · กระดาษ 80mm · B&W thermal
                  {lastPrint ? ` · พิมพ์ล่าสุด ${lastPrint}` : ''}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={checkStatus} style={btnGhost}>
                <Icon name="refresh" size={13} style={{ animation: printer === 'checking' ? 'spin 1s linear infinite' : 'none' }} />
                ตรวจสอบ
              </button>
              <button onClick={testPrint} disabled={testing || printer === 'offline'} style={{
                ...btnGhost, opacity: (testing || printer === 'offline') ? 0.5 : 1,
                cursor: (testing || printer === 'offline') ? 'not-allowed' : 'pointer',
              }}>
                <Icon name={testing ? 'check' : 'print'} size={13} />
                {testing ? 'กำลังพิมพ์...' : 'ทดสอบพิมพ์'}
              </button>
            </div>
            {printer === 'offline' && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'var(--color-danger-50)', borderRadius: 6, fontSize: 12, color: 'var(--color-danger)' }}>
                ออฟไลน์ — ตรวจสอบ IP และสายแลน
              </div>
            )}
          </Section>

          {/* IP config */}
          <Section title="IP เครื่องพิมพ์" desc="เปลี่ยน WiFi ก็แค่แก้ตรงนี้">
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={ipInput} onChange={e => setIpInput(e.target.value)}
                placeholder="192.168.1.129"
                style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }}
                onKeyDown={e => e.key === 'Enter' && saveIp()}
              />
              <button onClick={scanPrinters} disabled={scanning} style={{ ...btnGhost, whiteSpace: 'nowrap' }}>
                <Icon name="refresh" size={13} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
                {scanning ? 'ค้นหา...' : 'ค้นหา'}
              </button>
              <button onClick={saveIp} disabled={saving || ipInput.trim() === printerIp}
                style={{ ...btnAccent, opacity: (saving || ipInput.trim() === printerIp) ? 0.5 : 1 }}>
                {saving ? 'บันทึก...' : 'บันทึก'}
              </button>
            </div>
            {scanResults.length > 1 && (
              <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {scanResults.map(ip => (
                  <button key={ip} onClick={() => setIpInput(ip)} style={{
                    padding: '3px 10px', borderRadius: 6, fontSize: 12, fontFamily: 'monospace',
                    border: `1px solid ${ipInput === ip ? 'var(--color-accent)' : 'var(--color-border)'}`,
                    background: ipInput === ip ? 'var(--color-accent-50)' : 'var(--color-surface)',
                  }}>{ip}</button>
                ))}
              </div>
            )}
          </Section>
        </div>

        {/* Right column: store info */}
        <div>
          <Section title="ข้อมูลร้าน" desc="แสดงบนส่วนหัวใบเสร็จ">
            <div style={{ display: 'grid', gap: 10, marginBottom: 14 }}>
              <Field label="ชื่อร้าน *" value={storeInput} onChange={setStoreInput} placeholder="ร้านตะวันอ้อมข้าว" />
              <Field label="ที่อยู่" value={addressInput} onChange={setAddressInput} placeholder="123 ถ.ราชดำเนิน ต.ในเมือง..." />
              <Field label="เลขที่ผู้เสียภาษี" value={taxIdInput} onChange={setTaxIdInput} placeholder="0105544000001" mono />
              <Field label="สาขา" value={branchInput} onChange={setBranchInput} placeholder="สาขาที่ 00001" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={saveStoreInfo}
                disabled={savingStore || !storeInput.trim()}
                style={{
                  flex: 1, padding: '10px', borderRadius: 8,
                  background: (savingStore || !storeInput.trim()) ? 'var(--color-border)' : 'var(--color-primary)',
                  color: 'white', fontSize: 14, fontWeight: 700,
                  opacity: !storeInput.trim() ? 0.5 : 1,
                }}
              >
                {savingStore ? 'กำลังบันทึก...' : 'บันทึกข้อมูลร้าน'}
              </button>
              <button onClick={() => setPreviewOpen(true)} style={{ ...btnGhost, whiteSpace: 'nowrap' }}>
                <Icon name="eye" size={14} /> ดูตัวอย่างใบเสร็จ
              </button>
            </div>
          </Section>
        </div>
      </div>

      {/* Preview modal */}
      {previewOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setPreviewOpen(false); }}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(20,12,6,0.72)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '20px 16px 40px', overflowY: 'auto',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%', maxWidth: 660,
              background: 'var(--color-surface)', borderRadius: 18,
              boxShadow: '0 28px 72px rgba(61,40,23,0.25)',
              display: 'flex', flexDirection: 'column',
            }}
          >
            {/* Modal header */}
            <div style={{
              padding: '14px 20px', borderBottom: '1px solid var(--color-border)',
              display: 'flex', alignItems: 'center', gap: 10,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: 'var(--color-primary-50)', color: 'var(--color-primary)',
                display: 'grid', placeItems: 'center',
              }}>
                <Icon name="eye" size={16} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700 }}>ตัวอย่างใบเสร็จ (เรียลไทม์)</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  ข้อมูลสมมติ · อัปเดตตามข้อมูลร้านที่กรอกไว้
                </div>
              </div>
              <label style={{
                display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                padding: '5px 12px', borderRadius: 8, border: '1px solid',
                borderColor: previewBuyer ? 'var(--color-accent)' : 'var(--color-border)',
                background: previewBuyer ? 'var(--color-accent-50)' : 'transparent',
                fontSize: 13, fontWeight: previewBuyer ? 600 : 400,
                color: previewBuyer ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                userSelect: 'none',
              }}>
                <input
                  type="checkbox" checked={previewBuyer} onChange={e => setPreviewBuyer(e.target.checked)}
                  style={{ accentColor: 'var(--color-accent)' }}
                />
                ใบกำกับภาษี
              </label>
              <button onClick={() => setPreviewOpen(false)} style={{
                width: 30, height: 30, borderRadius: 6, display: 'grid', placeItems: 'center',
                color: 'var(--color-text-secondary)',
              }}>
                <Icon name="x" size={15} />
              </button>
            </div>

            {/* Receipt paper */}
            <div style={{ padding: '20px', overflowY: 'auto', maxHeight: '72vh' }}>
              <ReceiptPaper
                data={mockReceipt}
                buyer={previewBuyer ? MOCK_BUYER : undefined}
                invoiceNo={invoiceNo}
                now={previewNow}
                fmt={FMT}
                formatDate={FMT_DATE}
                formatTime={FMT_TIME}
                storeInfo={liveStore}
              />
              <div style={{
                marginTop: 10, padding: '8px 12px',
                background: 'var(--color-surface-2)', borderRadius: 6,
                fontSize: 11, color: 'var(--color-text-secondary)', textAlign: 'center',
              }}>
                ข้อมูลสมมติ — ใบเสร็จจริงเปิดหลังชำระเงินในหน้า POS
              </div>
            </div>

            <div style={{
              padding: '12px 20px', borderTop: '1px solid var(--color-border)',
              display: 'flex', justifyContent: 'flex-end',
            }}>
              <button onClick={() => setPreviewOpen(false)} style={{
                padding: '8px 20px', borderRadius: 8, fontSize: 13,
                border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)',
              }}>ปิด</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Helpers ─────────────────────────────────────────────────────── */

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: 'var(--color-surface)', border: '1px solid var(--color-border)',
      borderRadius: 12, padding: 18, marginBottom: 14, boxShadow: 'var(--shadow-xs)',
    }}>
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: desc ? 3 : 12 }}>{title}</div>
      {desc && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 12 }}>{desc}</div>}
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean;
}) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>{label}</div>
      <input
        value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        style={{ ...inputStyle, fontFamily: mono ? '"Courier New", monospace' : 'inherit' }}
        onFocus={e => (e.currentTarget.style.borderColor = 'var(--color-accent)')}
        onBlur={e => (e.currentTarget.style.borderColor = 'var(--color-border)')}
      />
    </div>
  );
}

function StatusDot({ s }: { s: PrinterStatus }) {
  const color = s === 'online' ? 'var(--color-success)' : s === 'offline' ? 'var(--color-danger)' : 'var(--color-warning)';
  const label = s === 'online' ? 'ออนไลน์' : s === 'offline' ? 'ออฟไลน์' : 'กำลังตรวจ...';
  const bg    = s === 'online' ? 'var(--color-success-50)' : s === 'offline' ? 'var(--color-danger-50)' : 'var(--color-warning-50)';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 99, background: bg }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: color, animation: s === 'checking' ? 'pulse 1s ease-in-out infinite' : 'none' }} />
      <span style={{ fontSize: 11, fontWeight: 600, color }}>{label}</span>
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 8,
  border: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
  fontSize: 13, outline: 'none', boxSizing: 'border-box',
};
const btnGhost: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', borderRadius: 8,
  border: '1px solid var(--color-border)', background: 'var(--color-surface-2)',
  fontSize: 13, fontWeight: 500, cursor: 'pointer', whiteSpace: 'nowrap',
};
const btnAccent: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '8px 16px', borderRadius: 8,
  background: 'var(--color-accent)', color: 'var(--color-primary-700)',
  fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', border: 'none',
};
