'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';

type PrinterStatus = 'online' | 'offline' | 'checking';

interface ReceiptItem { name: string; qty: number; unitPrice: number; mods?: string[] }
interface ReceiptData {
  storeName: string;
  orderNumber: string;
  items: ReceiptItem[];
  subtotal: number;
  total: number;
  paymentLabel: string;
}

const PREVIEW_ITEMS: ReceiptItem[] = [
  { name: 'ลาเต้เย็น', qty: 2, unitPrice: 65, mods: ['หวานน้อย', 'นมโอ๊ต'] },
  { name: 'คาปูชิโน่ร้อน', qty: 1, unitPrice: 55, mods: [] },
  { name: 'ชีสเค้ก', qty: 1, unitPrice: 120, mods: [] },
];

function ReceiptPreview({ data }: { data: ReceiptData }) {
  const W = 42;
  const dash = '-'.repeat(W);
  const fmt  = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const center = (s: string) => {
    const pad = Math.max(0, Math.floor((W - s.length) / 2));
    return ' '.repeat(pad) + s;
  };
  const leftRight = (l: string, r: string) => {
    const maxL = W - r.length - 1;
    const left = l.length > maxL ? l.substring(0, maxL) : l;
    return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r;
  };

  const now = new Date().toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div style={{
      fontFamily: '"Courier New", Courier, monospace',
      fontSize: 13,
      lineHeight: 1.6,
      whiteSpace: 'pre',
      background: '#fffef8',
      color: '#111',
      padding: '20px 16px 28px',
      borderRadius: '4px 4px 18px 18px',
      boxShadow: '0 8px 32px rgba(0,0,0,0.22)',
      width: `${W + 2}ch`,
      maxWidth: '100%',
      overflowX: 'auto',
      borderTop: '3px dashed #ccc',
    }}>
      {/* Store name — big */}
      <div style={{ textAlign: 'center', fontSize: 17, fontWeight: 900, letterSpacing: 1, marginBottom: 2 }}>
        {data.storeName}
      </div>
      <div style={{ marginBottom: 0 }}>{center(`ออเดอร์ #${data.orderNumber}`)}</div>
      <div style={{ marginBottom: 2 }}>{center(now)}</div>
      <div>{dash}</div>
      {data.items.map((item, i) => (
        <div key={i}>
          <div>{leftRight(item.name, fmt(item.qty * item.unitPrice))}</div>
          <div>{'  '}{item.qty} x {fmt(item.unitPrice)}</div>
          {item.mods?.filter(Boolean).map((mod, j) => (
            <div key={j} style={{ color: '#555' }}>{'  + '}{mod}</div>
          ))}
        </div>
      ))}
      <div>{dash}</div>
      <div>{leftRight('รวม', fmt(data.subtotal))}</div>
      <div style={{ fontWeight: 700 }}>{leftRight('รวมทั้งสิ้น', fmt(data.total))}</div>
      <div>{'ชำระ: '}{data.paymentLabel}</div>
      <div>{dash}</div>
      <div style={{ textAlign: 'center', marginTop: 4 }}>ขอบคุณที่ใช้บริการ</div>
    </div>
  );
}

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

  const [storeName, setStoreName]       = useState('');
  const [storeInput, setStoreInput]     = useState('');
  const [savingStore, setSavingStore]   = useState(false);
  const [previewOpen, setPreviewOpen]   = useState(false);

  const subtotal = PREVIEW_ITEMS.reduce((s, i) => s + i.qty * i.unitPrice, 0);
  const previewData: ReceiptData = {
    storeName: storeInput || storeName || 'ชื่อร้าน',
    orderNumber: '0042',
    items: PREVIEW_ITEMS,
    subtotal,
    total: subtotal,
    paymentLabel: 'เงินสด',
  };

  const checkStatus = useCallback(async () => {
    setPrinter('checking');
    try {
      const res  = await fetch('/api/print', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      setPrinter(data.printer ? 'online' : 'offline');
      if (data.ip) { setPrinterIp(data.ip); setIpInput(data.ip); }
    } catch {
      setPrinter('offline');
    }
  }, []);

  useEffect(() => {
    fetch('/api/print/config').then(r => r.json()).then(cfg => {
      setPrinterIp(cfg.ip ?? '');
      setIpInput(cfg.ip ?? '');
      setStoreName(cfg.storeName ?? '');
      setStoreInput(cfg.storeName ?? '');
    });
    checkStatus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const scanPrinters = async () => {
    setScanning(true);
    setScanResults([]);
    try {
      const res = await fetch('/api/print/scan', { signal: AbortSignal.timeout(120000) });
      const data = await res.json();
      setScanResults(data.found ?? []);
      if (data.found?.length === 1) {
        setIpInput(data.found[0]);
        toast({ kind: 'success', title: 'พบเครื่องปริ้น', msg: data.found[0] });
      } else if (data.found?.length === 0) {
        toast({ kind: 'warning', title: 'ไม่พบเครื่องปริ้น', msg: 'ตรวจสอบว่าเปิดเครื่องและต่อสายแลนอยู่' });
      }
    } catch (err: any) {
      toast({ kind: 'warning', title: 'scan ไม่สำเร็จ', msg: err.message });
    } finally {
      setScanning(false);
    }
  };

  const saveIp = async () => {
    const ip = ipInput.trim();
    if (!ip) return;
    setSaving(true);
    try {
      const res = await fetch('/api/print/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setPrinterIp(ip);
      toast({ kind: 'success', title: 'บันทึกแล้ว', msg: `IP: ${ip}` });
      checkStatus();
    } catch (err: any) {
      toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg: err.message });
    } finally {
      setSaving(false);
    }
  };

  const saveStoreName = async () => {
    const name = storeInput.trim();
    if (!name) return;
    setSavingStore(true);
    try {
      const res = await fetch('/api/print/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ip: printerIp, storeName: name }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setStoreName(name);
      toast({ kind: 'success', title: 'บันทึกชื่อร้านแล้ว', msg: name });
    } catch (err: any) {
      toast({ kind: 'warning', title: 'บันทึกไม่สำเร็จ', msg: err.message });
    } finally {
      setSavingStore(false);
    }
  };

  const testPrint = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeName,
          orderNumber:  'TEST',
          items:        [{ name: 'ทดสอบการพิมพ์', qty: 1, unitPrice: 0, mods: [] }],
          subtotal:     0,
          total:        0,
          paymentLabel: 'ทดสอบ',
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setLastPrint(new Date().toLocaleTimeString('th-TH'));
      toast({ kind: 'success', title: 'พิมพ์ทดสอบสำเร็จ', msg: 'ตรวจสอบใบเสร็จที่พิมพ์ออกมา' });
    } catch (err: any) {
      toast({ kind: 'warning', title: 'พิมพ์ไม่สำเร็จ', msg: err.message });
    } finally {
      setTesting(false);
    }
  };

  const StatusDot = ({ s }: { s: PrinterStatus }) => {
    const color = s === 'online' ? 'var(--color-success)' : s === 'offline' ? 'var(--color-danger)' : 'var(--color-warning)';
    const label = s === 'online' ? 'ออนไลน์' : s === 'offline' ? 'ออฟไลน์' : 'กำลังตรวจสอบ...';
    const bg    = s === 'online' ? 'var(--color-success-50)' : s === 'offline' ? 'var(--color-danger-50)' : 'var(--color-warning-50)';
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 10px', borderRadius: 99, background: bg }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: color, animation: s === 'checking' ? 'pulse 1s ease-in-out infinite' : 'none' }} />
        <span style={{ fontSize: 12, fontWeight: 600, color }}>{label}</span>
      </span>
    );
  };

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
        @keyframes spin  { to{transform:rotate(360deg)} }
      `}</style>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 4 }}>Hardware / เครื่องพิมพ์</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จัดการเครื่องพิมพ์ใบเสร็จ</div>
        </div>
        <button onClick={checkStatus} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          <Icon name="refresh" size={15} style={{ animation: printer === 'checking' ? 'spin 1s linear infinite' : 'none' }} />
          รีเฟรชสถานะ
        </button>
      </div>

      {/* IP Config */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>IP เครื่องพิมพ์</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 14 }}>
          เปลี่ยน WiFi หรือย้ายร้าน แค่แก้ IP ตรงนี้ — ไม่ต้องแตะโค้ด
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={ipInput}
            onChange={e => setIpInput(e.target.value)}
            placeholder="192.168.1.129"
            style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 14, fontFamily: 'monospace' }}
            onKeyDown={e => e.key === 'Enter' && saveIp()}
          />
          <button
            onClick={scanPrinters}
            disabled={scanning}
            title="ค้นหาเครื่องปริ้นในเครือข่ายอัตโนมัติ"
            style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 13, fontWeight: 500, cursor: scanning ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Icon name="refresh" size={14} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
            {scanning ? 'กำลังค้นหา...' : 'ค้นหา'}
          </button>
          <button
            onClick={saveIp}
            disabled={saving || ipInput.trim() === printerIp}
            style={{ padding: '9px 20px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: (saving || ipInput.trim() === printerIp) ? 'not-allowed' : 'pointer', opacity: (saving || ipInput.trim() === printerIp) ? 0.6 : 1, whiteSpace: 'nowrap' }}
          >
            {saving ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
        {scanResults.length > 1 && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--color-surface-2)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>พบอุปกรณ์ที่เป็นไปได้ {scanResults.length} เครื่อง — เลือก IP ที่ถูกต้อง:</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {scanResults.map(ip => (
                <button key={ip} onClick={() => setIpInput(ip)} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${ipInput === ip ? 'var(--color-accent)' : 'var(--color-border)'}`, background: ipInput === ip ? 'var(--color-accent)' : 'var(--color-surface)', fontSize: 13, fontFamily: 'monospace', cursor: 'pointer' }}>
                  {ip}
                </button>
              ))}
            </div>
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>
          กด <strong>ค้นหา</strong> เพื่อหา IP เครื่องปริ้นอัตโนมัติ (ใช้เวลา ~30 วินาที) หรือดูจาก EpsonNet Config
        </div>
      </div>

      {/* Printer card */}
      <div style={{ background: 'var(--color-surface)', border: `1px solid ${printer === 'offline' ? 'var(--color-danger-50)' : 'var(--color-border)'}`, borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--color-surface-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="printer" size={26} color="var(--color-text-secondary)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>EPSON TM-T82X</span>
              <StatusDot s={printer} />
            </div>
            <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="wifi" size={12} /> LAN</span>
              <span>IP: {printerIp || '—'}</span>
              <span>กระดาษ: 80mm</span>
              {lastPrint && <span>พิมพ์ล่าสุด: {lastPrint}</span>}
            </div>
          </div>
          <button
            onClick={testPrint}
            disabled={testing || printer === 'offline'}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: testing ? 'var(--color-success-50)' : 'var(--color-surface-2)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, cursor: (testing || printer === 'offline') ? 'not-allowed' : 'pointer', color: testing ? 'var(--color-success)' : 'inherit', opacity: printer === 'offline' ? 0.5 : 1 }}
          >
            <Icon name={testing ? 'check' : 'print'} size={14} color={testing ? 'var(--color-success)' : 'currentColor'} />
            {testing ? 'กำลังพิมพ์...' : 'ทดสอบพิมพ์'}
          </button>
        </div>
        {printer === 'offline' && (
          <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>ตรวจสอบ:</div>
            <ul style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, paddingLeft: 16, lineHeight: 1.8 }}>
              <li>เปิดเครื่องปริ้นอยู่ไหม?</li>
              <li>สายแลนเสียบเข้า Router อยู่ไหม?</li>
              <li>IP ข้างบนตรงกับที่ EpsonNet Config แสดงไหม?</li>
            </ul>
          </div>
        )}
      </div>

      {/* Receipt Settings */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>การตั้งค่าใบเสร็จ</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>ชื่อร้านที่แสดงบนใบเสร็จ · ขนาดกระดาษ 80mm</div>

        {/* Store name */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 6 }}>ชื่อร้าน</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input
              value={storeInput}
              onChange={e => setStoreInput(e.target.value)}
              placeholder="ชื่อร้านของคุณ"
              style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 14 }}
              onKeyDown={e => e.key === 'Enter' && saveStoreName()}
            />
            <button
              onClick={saveStoreName}
              disabled={savingStore || storeInput.trim() === storeName}
              style={{ padding: '9px 20px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: (savingStore || storeInput.trim() === storeName) ? 'not-allowed' : 'pointer', opacity: (savingStore || storeInput.trim() === storeName) ? 0.6 : 1, whiteSpace: 'nowrap' }}
            >
              {savingStore ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setPreviewOpen(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}
          >
            <Icon name="eye" size={15} /> ดูตัวอย่างใบเสร็จ
          </button>
          <button
            onClick={testPrint}
            disabled={testing || printer === 'offline'}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, fontWeight: 500, cursor: printer === 'offline' ? 'not-allowed' : 'pointer', opacity: printer === 'offline' ? 0.5 : 1 }}
          >
            <Icon name="print" size={15} /> ทดสอบพิมพ์ใบเสร็จ
          </button>
        </div>
      </div>

      {/* Receipt Preview Modal */}
      {previewOpen && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setPreviewOpen(false); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div style={{ background: 'var(--color-surface)', borderRadius: 16, padding: 28, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 17 }}>ตัวอย่างใบเสร็จ</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>แสดงหน้าตาที่จะปริ้นออกมาจริง</div>
              </div>
              <button
                onClick={() => setPreviewOpen(false)}
                style={{ width: 32, height: 32, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', cursor: 'pointer', display: 'grid', placeItems: 'center', fontSize: 18, lineHeight: 1 }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <ReceiptPreview data={previewData} />
            </div>

            <div style={{ marginTop: 20, padding: '12px 14px', background: 'var(--color-surface-2)', borderRadius: 8, fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              <strong>ตัวอย่างนี้ใช้ข้อมูลสมมติ</strong> — รายการจริงจะแสดงเมื่อกด ชำระเงิน ในหน้า POS
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
