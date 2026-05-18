'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';

type PrinterStatus = 'online' | 'offline' | 'checking';

const TEST_PAYLOAD = {
  storeName:    'ร้านตะวันอ้อมข้าว',
  orderNumber:  'TEST',
  items:        [{ name: 'ทดสอบการพิมพ์', qty: 1, unitPrice: 0, mods: [] }],
  subtotal:     0,
  total:        0,
  paymentLabel: 'ทดสอบ',
};

export default function HardwareScreen() {
  const toast = useToast();
  const [printer, setPrinter]     = useState<PrinterStatus>('checking');
  const [printerIp, setPrinterIp] = useState('192.168.192.168');
  const [testing, setTesting]     = useState(false);
  const [lastPrint, setLastPrint] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    setPrinter('checking');
    try {
      const res  = await fetch('/api/print', { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      setPrinter(data.printer ? 'online' : 'offline');
      if (data.ip) setPrinterIp(data.ip);
    } catch {
      setPrinter('offline');
    }
  }, []);

  useEffect(() => { checkStatus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const testPrint = async () => {
    setTesting(true);
    try {
      const res = await fetch('/api/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(TEST_PAYLOAD),
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
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} } @keyframes spin { to{transform:rotate(360deg)} }`}</style>

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
              <span>IP: {printerIp}</span>
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
              <li>สายแลนเสียบอยู่ไหม?</li>
              <li>เครื่องปริ้นอยู่ในเครือข่ายเดียวกันกับ router ไหม?</li>
            </ul>
          </div>
        )}
      </div>

      {/* Settings */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>การตั้งค่าใบเสร็จ</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>ขนาดกระดาษ 80mm · พิมพ์อัตโนมัติหลังชำระเงิน</div>
        <button
          onClick={testPrint}
          disabled={testing || printer === 'offline'}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, fontWeight: 500, cursor: printer === 'offline' ? 'not-allowed' : 'pointer', opacity: printer === 'offline' ? 0.5 : 1 }}
        >
          <Icon name="print" size={15} /> ทดสอบพิมพ์ใบเสร็จ
        </button>
      </div>
    </div>
  );
}
