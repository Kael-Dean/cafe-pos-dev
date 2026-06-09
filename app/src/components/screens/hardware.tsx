'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { ReceiptPaper, type ReceiptData, type StoreInfo } from './receipt-modal';
import { fetchStatus, fetchConfig, saveConfig, listPrinters } from '@/lib/printer-bridge';
import { usePrinter } from '@/hooks/use-printer';

type PrinterStatus = 'online' | 'offline' | 'checking';

/* ── Mock data (mirrors a real cafe receipt: sweetness mods + customer name) ── */

const MOCK_ITEMS = [
  { name: 'ลาเต้เย็น',        qty: 2, unitPrice: 65, mods: ['หวานน้อย', 'นมโอ๊ต'] },
  { name: 'อเมริกาโน่ร้อน',    qty: 1, unitPrice: 50, mods: ['ไม่หวาน'] },
  { name: 'ชาไทยเย็น',        qty: 1, unitPrice: 55, mods: ['หวานปกติ', 'เพิ่มไข่มุก'] },
  { name: 'คุกกี้ช็อกชิป',      qty: 2, unitPrice: 45 },
];
const MOCK_CUSTOMER = 'คุณสมหญิง ใจดี';
function makeMockReceipt(): ReceiptData {
  const subtotal = MOCK_ITEMS.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const cashGiven = Math.ceil((subtotal + 1) / 100) * 100; // round up to next ฿100 like a real cash sale
  return {
    orderNumber: '0042', items: MOCK_ITEMS,
    subtotal, total: subtotal,
    paymentMethod: 'cash', paymentLabel: 'เงินสด', cashGiven,
    memberName: MOCK_CUSTOMER,
  };
}

const FMT      = (n: number) => n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const FMT_DATE = (d: Date)   => d.toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
const FMT_TIME = (d: Date)   => d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Match the bridge's AN581 auto-detect so the "ค้นหาใหม่" button picks the same printer.
const matchAn581 = (names: string[]) =>
  names.find(n => /an[\s_-]?581/i.test(n)) ??
  names.find(n => /(58mm|pos[\s_-]?58|thermal|receipt|gprinter|xprinter|rongta)/i.test(n)) ??
  null;

/* ─────────────────────────────────────────────────────────────────── */

export default function HardwareScreen() {
  const toast = useToast();
  const { printReceipt } = usePrinter();
  const [printer, setPrinter]       = useState<PrinterStatus>('checking');
  const [printerName, setPrinterName] = useState('AN581-C'); // resolved USB printer name
  const [detecting, setDetecting]   = useState(false);
  const [testing, setTesting]       = useState(false);
  const [lastPrint, setLastPrint]   = useState<string | null>(null);

  const [storeInput, setStoreInput]     = useState('');
  const [addressInput, setAddressInput] = useState('');
  const [taxIdInput, setTaxIdInput]     = useState('');
  const [branchInput, setBranchInput]   = useState('');
  const [savingStore, setSavingStore]   = useState(false);

  const [previewOpen, setPreviewOpen] = useState(false);
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

  // USB-only: the bridge auto-resolves the AN581 and reports it as online whenever the
  // driver is installed + USB plugged in — so this stays online across idle and reboot.
  const checkStatus = useCallback(async () => {
    setPrinter('checking');
    try {
      const data = await fetchStatus(AbortSignal.timeout(8000));
      setPrinter(data.printer ? 'online' : 'offline');
      if (data.printerName) setPrinterName(data.printerName);
    } catch { setPrinter('offline'); }
  }, []);

  // Manual "ค้นหาใหม่": only needed after a fresh driver install / printer rename.
  // Forces USB mode, finds the AN581 among installed printers, saves it, re-checks.
  const detectPrinter = useCallback(async () => {
    setDetecting(true);
    try {
      const found = matchAn581(await listPrinters(AbortSignal.timeout(15000)));
      await saveConfig(found ? { mode: 'usb', printerName: found } : { mode: 'usb' });
      if (found) {
        setPrinterName(found);
        toast({ kind: 'success', title: 'เชื่อมต่อแล้ว', msg: found });
      } else {
        toast({ kind: 'warning', title: 'ไม่พบ AN581-C', msg: 'เสียบสาย USB และติดตั้งไดรเวอร์เครื่องพิมพ์แล้วลองใหม่' });
      }
      await checkStatus();
    } catch (err: unknown) {
      toast({ kind: 'warning', title: 'เชื่อมต่อไม่สำเร็จ', msg: (err as Error).message });
    } finally { setDetecting(false); }
  }, [checkStatus, toast]);

  useEffect(() => {
    fetchConfig().then(cfg => {
      if (cfg.printerName) setPrinterName(cfg.printerName);
      setStoreInput(cfg.storeName      ?? '');
      setAddressInput(cfg.storeAddress ?? '');
      setTaxIdInput(cfg.storeTaxId     ?? '');
      setBranchInput(cfg.storeBranch   ?? '');
      // Lock this install to USB (AN581) — older configs may still be on LAN.
      if (cfg.mode !== 'usb') saveConfig({ mode: 'usb' }).catch(() => {});
    }).catch(() => {});
    checkStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveStoreInfo = async () => {
    const name = storeInput.trim();
    if (!name) return;
    setSavingStore(true);
    try {
      await saveConfig({
        storeName:    name,
        storeAddress: addressInput.trim() || null,
        storeTaxId:   taxIdInput.trim()   || null,
        storeBranch:  branchInput.trim()  || null,
      });
      toast({ kind: 'success', title: 'บันทึกข้อมูลร้านแล้ว', msg: name });
    } catch (err: unknown) {
      toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg: (err as Error).message });
    } finally { setSavingStore(false); }
  };

  const testPrint = async () => {
    setTesting(true);
    try {
      // Use the same builder + body as a real POS receipt, with mock data that mirrors
      // an actual sale (items with sweetness mods + a customer name) and the store info
      // entered above. This keeps the test print identical in structure to the real one.
      const mock = makeMockReceipt();
      const storeOverride: Partial<StoreInfo> = {};
      if (storeInput.trim())   storeOverride.name    = storeInput.trim();
      if (addressInput.trim()) storeOverride.address = addressInput.trim();
      if (taxIdInput.trim())   storeOverride.taxId   = taxIdInput.trim();
      if (branchInput.trim())  storeOverride.branch  = branchInput.trim();
      await printReceipt({
        orderNumber:   mock.orderNumber,
        items:         mock.items,
        subtotal:      mock.subtotal,
        total:         mock.total,
        paymentMethod: mock.paymentMethod,
        cashGiven:     mock.cashGiven,
        memberName:    mock.memberName,
        store:         storeOverride,
      });
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
        {/* Left column: printer status + USB connection */}
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
                  <span style={{ fontWeight: 700, fontSize: 14 }}>{printerName || 'เครื่องพิมพ์ USB'}</span>
                  <StatusDot s={printer} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  USB: {printerName || 'AN581-C'} · กระดาษ 58mm · B&W thermal
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
                ออฟไลน์ — เสียบสาย USB เครื่องพิมพ์ AN581-C และติดตั้งไดรเวอร์แล้วกด “ค้นหาใหม่”
              </div>
            )}
          </Section>

          {/* USB connection — locked to the AN581, auto-reconnects on boot */}
          <Section title="การเชื่อมต่อ USB" desc="เครื่องพิมพ์ใบเสร็จ AN581-C ผ่านสาย USB">
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px', borderRadius: 8,
              background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
            }}>
              <Icon name="usb" size={18} color="var(--color-text-secondary)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{printerName || 'AN581-C'}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  {printer === 'online'   ? 'พร้อมใช้งาน — เชื่อมต่ออัตโนมัติ'
                   : printer === 'checking' ? 'กำลังตรวจสอบ...'
                   : 'ยังไม่พบเครื่องพิมพ์'}
                </div>
              </div>
              <button onClick={detectPrinter} disabled={detecting} style={{ ...btnGhost, opacity: detecting ? 0.6 : 1 }}>
                <Icon name="refresh" size={13} style={{ animation: detecting ? 'spin 1s linear infinite' : 'none' }} />
                {detecting ? 'กำลังค้นหา...' : 'ค้นหาใหม่'}
              </button>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--color-text-secondary)' }}>
              เสียบสาย USB เครื่องพิมพ์ AN581-C เข้ากับเครื่องนี้และติดตั้งไดรเวอร์ — ระบบจะเชื่อมต่อให้อัตโนมัติทุกครั้งที่เปิดเครื่อง ไม่ต้องตั้งค่าซ้ำ · ตัดกระดาษอัตโนมัติ
            </div>
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
