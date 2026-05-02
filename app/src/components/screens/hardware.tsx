'use client';

import { useState, useEffect } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';

type PrinterStatus = 'connected' | 'offline' | 'connecting';
type ConnectionType = 'usb' | 'wifi' | 'bluetooth';
type PrinterType = 'receipt' | 'label' | 'kitchen';

interface Printer {
  id: string;
  name: string;
  type: PrinterType;
  connection: ConnectionType;
  status: PrinterStatus;
  port?: string;
  ip?: string;
  paperWidth: string;
  lastPrint: string;
}

interface DiscoveredPrinter {
  id: string;
  name: string;
  connection: ConnectionType;
  port?: string;
  ip?: string;
}

const STORAGE_KEY = 'kafe_printers';

const DEFAULT_PRINTERS: Printer[] = [
  { id: 'hw1', name: 'EPSON TM-T88VI', type: 'receipt', connection: 'usb', status: 'connected', port: 'USB001', paperWidth: '80mm', lastPrint: '2 นาทีที่แล้ว' },
  { id: 'hw2', name: 'BROTHER QL-820NWB', type: 'label', connection: 'wifi', status: 'connected', ip: '192.168.1.105', paperWidth: '62mm', lastPrint: '1 ชั่วโมงที่แล้ว' },
  { id: 'hw3', name: 'STAR TSP143', type: 'receipt', connection: 'wifi', status: 'offline', ip: '192.168.1.110', paperWidth: '80mm', lastPrint: 'เมื่อวาน' },
];

const STATUS_COLOR: Record<PrinterStatus, string> = {
  connected: 'var(--color-success)',
  offline: 'var(--color-danger)',
  connecting: 'var(--color-warning)',
};
const STATUS_BG: Record<PrinterStatus, string> = {
  connected: 'var(--color-success-50)',
  offline: 'var(--color-danger-50)',
  connecting: 'var(--color-warning-50)',
};
const STATUS_LABEL: Record<PrinterStatus, string> = {
  connected: 'เชื่อมต่อแล้ว',
  offline: 'ออฟไลน์',
  connecting: 'กำลังเชื่อมต่อ...',
};
const CONN_ICON: Record<ConnectionType, string> = { usb: 'usb', wifi: 'wifi', bluetooth: 'bluetooth' };

const IS = {
  padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)',
  background: 'var(--color-surface-2)', color: 'var(--color-text)', fontSize: 14,
} as React.CSSProperties;

export default function HardwareScreen() {
  const toast = useToast();
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<DiscoveredPrinter[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ name: '', type: 'receipt' as PrinterType, connection: 'usb' as ConnectionType, ip: '', port: '' });
  const [receiptSize, setReceiptSize] = useState('80mm');

  // Load from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      setPrinters(saved ? JSON.parse(saved) : DEFAULT_PRINTERS);
      setReceiptSize(localStorage.getItem('receipt_size') ?? '80mm');
    } catch {
      setPrinters(DEFAULT_PRINTERS);
    }
  }, []);

  // Persist on change
  useEffect(() => {
    if (printers.length > 0) localStorage.setItem(STORAGE_KEY, JSON.stringify(printers));
  }, [printers]);

  const scan = () => {
    setScanning(true);
    setScanResult([]);
    setTimeout(() => {
      setScanResult([
        { id: 'disc1', name: 'EPSON TM-T20III', connection: 'usb', port: 'USB002' },
        { id: 'disc2', name: 'CITIZEN CT-S310II', connection: 'wifi', ip: '192.168.1.118' },
      ]);
      setScanning(false);
    }, 2200);
  };

  const addDiscovered = (disc: DiscoveredPrinter) => {
    const np: Printer = { id: 'hw' + Date.now(), name: disc.name, type: 'receipt', connection: disc.connection, status: 'connected', port: disc.port, ip: disc.ip, paperWidth: '80mm', lastPrint: 'เพิ่งเพิ่ม' };
    setPrinters(p => [...p, np]);
    setScanResult(r => r.filter(x => x.id !== disc.id));
    toast({ kind: 'success', title: `เพิ่ม ${disc.name} แล้ว` });
  };

  const handleManualAdd = () => {
    if (!addForm.name.trim()) { toast({ kind: 'warning', title: 'กรอกชื่อเครื่องพิมพ์' }); return; }
    const np: Printer = { id: 'hw' + Date.now(), ...addForm, status: 'connected', paperWidth: '80mm', lastPrint: 'เพิ่งเพิ่ม' };
    setPrinters(p => [...p, np]);
    setShowAddForm(false);
    setAddForm({ name: '', type: 'receipt', connection: 'usb', ip: '', port: '' });
    toast({ kind: 'success', title: 'เพิ่มเครื่องพิมพ์แล้ว' });
  };

  const testPrint = (id: string) => {
    setPrintingId(id);
    setTimeout(() => {
      setPrintingId(null);
      toast({ kind: 'success', title: 'พิมพ์ทดสอบเสร็จแล้ว', msg: 'ตรวจสอบใบเสร็จที่พิมพ์ออกมา' });
    }, 1800);
  };

  const reconnect = (id: string) => {
    setPrinters(p => p.map(x => x.id === id ? { ...x, status: 'connecting' } : x));
    setTimeout(() => {
      setPrinters(p => p.map(x => x.id === id ? { ...x, status: 'connected', lastPrint: 'เพิ่งเชื่อมต่อ' } : x));
      toast({ kind: 'success', title: 'เชื่อมต่อสำเร็จ' });
    }, 2000);
  };

  const remove = (id: string) => {
    if (!confirm('ลบเครื่องพิมพ์นี้?')) return;
    setPrinters(p => p.filter(x => x.id !== id));
    toast({ kind: 'success', title: 'ลบแล้ว' });
  };

  const connectedPrinters = printers.filter(p => p.status === 'connected');

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: 32 }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .5; } }
      `}</style>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em', marginBottom: 4 }}>Hardware / เครื่องพิมพ์</h1>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>จัดการเครื่องพิมพ์ใบเสร็จและอุปกรณ์ต่อพ่วง</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={scan} disabled={scanning}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 500, cursor: scanning ? 'default' : 'pointer', opacity: scanning ? 0.7 : 1 }}>
            <Icon name="refresh" size={15} style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
            {scanning ? 'กำลังค้นหา...' : 'ค้นหาเครื่องพิมพ์'}
          </button>
          <button onClick={() => setShowAddForm(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>
            <Icon name="plus" size={15} /> เพิ่มด้วยตัวเอง
          </button>
        </div>
      </div>

      {/* Scan results */}
      {(scanning || scanResult.length > 0) && (
        <div style={{ background: 'var(--color-info-50)', border: '1px solid #B9D0E8', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, fontWeight: 600, color: 'var(--color-info)' }}>
            <Icon name={scanning ? 'refresh' : 'wifi'} size={16} color="var(--color-info)" style={{ animation: scanning ? 'spin 1s linear infinite' : 'none' }} />
            {scanning ? 'กำลังค้นหาเครื่องพิมพ์...' : 'พบเครื่องพิมพ์ใหม่'}
          </div>
          {scanning && (
            <div style={{ display: 'flex', gap: 8 }}>
              {[1, 2].map(i => <div key={i} style={{ height: 60, flex: 1, background: 'rgba(74,111,165,.1)', borderRadius: 8, animation: 'pulse 1.4s ease-in-out infinite' }} />)}
            </div>
          )}
          {scanResult.map(d => (
            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 8, marginBottom: 8, border: '1px solid var(--color-border)' }}>
              <Icon name={CONN_ICON[d.connection]} size={18} color="var(--color-info)" />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{d.name}</div>
                <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>{d.connection === 'usb' ? `Port: ${d.port}` : `IP: ${d.ip}`}</div>
              </div>
              <button onClick={() => addDiscovered(d)} style={{ padding: '7px 14px', borderRadius: 7, background: 'var(--color-info)', color: 'white', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>เพิ่ม</button>
            </div>
          ))}
        </div>
      )}

      {/* Manual add form */}
      {showAddForm && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, marginBottom: 20, boxShadow: 'var(--shadow-sm)' }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 14 }}>เพิ่มเครื่องพิมพ์ด้วยตัวเอง</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ชื่อเครื่องพิมพ์ *</label>
              <input value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} style={{ ...IS, width: '100%' }} placeholder="เช่น EPSON TM-T88VI" />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ประเภท</label>
              <select value={addForm.type} onChange={e => setAddForm(f => ({ ...f, type: e.target.value as PrinterType }))} style={{ ...IS, width: '100%' }}>
                <option value="receipt">เครื่องพิมพ์ใบเสร็จ</option>
                <option value="label">เครื่องพิมพ์ Label</option>
                <option value="kitchen">เครื่องพิมพ์ครัว</option>
              </select>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>การเชื่อมต่อ</label>
              <select value={addForm.connection} onChange={e => setAddForm(f => ({ ...f, connection: e.target.value as ConnectionType }))} style={{ ...IS, width: '100%' }}>
                <option value="usb">USB</option>
                <option value="wifi">Wi-Fi / LAN</option>
                <option value="bluetooth">Bluetooth</option>
              </select>
            </div>
            {addForm.connection === 'usb' ? (
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>Port</label>
                <input value={addForm.port} onChange={e => setAddForm(f => ({ ...f, port: e.target.value }))} style={{ ...IS, width: '100%' }} placeholder="เช่น USB001" />
              </div>
            ) : (
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>IP Address</label>
                <input value={addForm.ip} onChange={e => setAddForm(f => ({ ...f, ip: e.target.value }))} style={{ ...IS, width: '100%' }} placeholder="เช่น 192.168.1.100" />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            <button onClick={handleManualAdd} style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}>เพิ่มเครื่องพิมพ์</button>
            <button onClick={() => setShowAddForm(false)} style={{ padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, cursor: 'pointer' }}>ยกเลิก</button>
          </div>
        </div>
      )}

      {/* Printer list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
        {printers.length === 0 && (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--color-text-muted)' }}>
            <Icon name="printer" size={40} color="var(--color-border)" />
            <div style={{ marginTop: 12 }}>ยังไม่มีเครื่องพิมพ์</div>
          </div>
        )}
        {printers.map(printer => {
          const isTesting = printingId === printer.id;
          return (
            <div key={printer.id} style={{ background: 'var(--color-surface)', border: `1px solid ${printer.status === 'offline' ? 'var(--color-danger-50)' : 'var(--color-border)'}`, borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-xs)', display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 48, height: 48, borderRadius: 10, background: 'var(--color-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name="printer" size={24} color="var(--color-text-secondary)" />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 15 }}>{printer.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 99, background: STATUS_BG[printer.status] }}>
                    <div style={{ width: 6, height: 6, borderRadius: 99, background: STATUS_COLOR[printer.status], animation: printer.status === 'connecting' ? 'pulse 1s ease-in-out infinite' : 'none' }} />
                    <span style={{ fontSize: 11, fontWeight: 600, color: STATUS_COLOR[printer.status] }}>{STATUS_LABEL[printer.status]}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--color-text-secondary)', flexWrap: 'wrap' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Icon name={CONN_ICON[printer.connection]} size={12} />
                    {printer.connection.toUpperCase()}
                  </span>
                  {printer.port && <span>Port: {printer.port}</span>}
                  {printer.ip && <span>IP: {printer.ip}</span>}
                  <span>กระดาษ: {printer.paperWidth}</span>
                  <span>พิมพ์ล่าสุด: {printer.lastPrint}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                {printer.status !== 'connected' && (
                  <button onClick={() => reconnect(printer.id)} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <Icon name="refresh" size={13} /> เชื่อมต่อใหม่
                  </button>
                )}
                {printer.status === 'connected' && (
                  <button onClick={() => testPrint(printer.id)} disabled={isTesting}
                    style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid var(--color-border)', background: isTesting ? 'var(--color-success-50)' : 'var(--color-surface-2)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, cursor: isTesting ? 'default' : 'pointer', color: isTesting ? 'var(--color-success)' : 'inherit' }}>
                    <Icon name={isTesting ? 'check' : 'print'} size={13} color={isTesting ? 'var(--color-success)' : 'currentColor'} />
                    {isTesting ? 'กำลังพิมพ์...' : 'ทดสอบพิมพ์'}
                  </button>
                )}
                <button onClick={() => remove(printer.id)} style={{ padding: '7px 10px', borderRadius: 7, border: '1px solid var(--color-border)', background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer' }}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Print settings */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>การตั้งค่าใบเสร็จ</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>ตั้งค่ารูปแบบและขนาดใบเสร็จสำหรับทุกเครื่องพิมพ์</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>ขนาดกระดาษ</label>
            <select value={receiptSize} onChange={e => { setReceiptSize(e.target.value); localStorage.setItem('receipt_size', e.target.value); }} style={{ ...IS, width: '100%' }}>
              <option value="80mm">80mm (มาตรฐาน)</option>
              <option value="58mm">58mm (เล็ก)</option>
              <option value="a4">A4</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 4 }}>เครื่องพิมพ์หลัก</label>
            <select style={{ ...IS, width: '100%' }} defaultValue={connectedPrinters[0]?.id ?? ''}>
              {connectedPrinters.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              {connectedPrinters.length === 0 && <option value="">ไม่มีเครื่องพิมพ์</option>}
            </select>
          </div>
        </div>
        <button onClick={() => window.print()}
          style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          <Icon name="print" size={15} /> ทดสอบพิมพ์ทั้งระบบ
        </button>
      </div>
    </div>
  );
}
