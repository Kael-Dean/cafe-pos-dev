'use client';

import { useState, useEffect, useCallback } from 'react';
import Icon from '../icons';
import { useToast } from '../app-common';
import { DEFAULT_BRIDGE, getBridgeUrl } from '@/hooks/use-printer';

type BridgeStatus = 'checking' | 'online' | 'offline';
type PrinterStatus = 'online' | 'offline' | 'checking';

export default function HardwareScreen() {
  const toast = useToast();
  const [bridge, setBridge]         = useState<BridgeStatus>('checking');
  const [printer, setPrinter]       = useState<PrinterStatus>('checking');
  const [printerIp, setPrinterIp]   = useState('192.168.192.168');
  const [testing, setTesting]       = useState(false);
  const [lastPrint, setLastPrint]   = useState<string | null>(null);
  const [bridgeUrl, setBridgeUrl]   = useState(DEFAULT_BRIDGE);
  const [urlInput, setUrlInput]     = useState(DEFAULT_BRIDGE);
  const [connecting, setConnecting] = useState(false);

  const checkStatus = useCallback(async (url?: string) => {
    const target = url ?? bridgeUrl;
    setBridge('checking');
    setPrinter('checking');
    try {
      const res  = await fetch(`${target}/status`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      setBridge('online');
      setPrinter(data.printer ? 'online' : 'offline');
      if (data.ip) setPrinterIp(data.ip);
    } catch {
      setBridge('offline');
      setPrinter('offline');
    }
  }, [bridgeUrl]);

  const connectBridge = async () => {
    const url = urlInput.trim().replace(/\/$/, '');
    setConnecting(true);
    try {
      const res  = await fetch(`${url}/status`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      if (data.bridge) {
        localStorage.setItem('print_bridge_url', url);
        setBridgeUrl(url);
        setBridge('online');
        setPrinter(data.printer ? 'online' : 'offline');
        if (data.ip) setPrinterIp(data.ip);
        toast({ kind: 'success', title: 'เชื่อมต่อสำเร็จ', msg: url });
      }
    } catch {
      toast({ kind: 'warning', title: 'เชื่อมต่อไม่ได้', msg: 'ตรวจสอบว่า print-server.js รันอยู่บนเครื่องนั้น' });
      setBridge('offline');
      setPrinter('offline');
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => { const url = getBridgeUrl(); setBridgeUrl(url); setUrlInput(url); checkStatus(url); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const testPrint = async () => {
    if (bridge !== 'online') {
      toast({ kind: 'warning', title: 'Print bridge ไม่ได้รัน', msg: 'รัน: node D:\\POS\\print-server.js' });
      return;
    }
    setTesting(true);
    try {
      const res = await fetch(`${bridgeUrl}/test`, { method: 'POST' });
      if (!res.ok) throw new Error((await res.json()).error);
      setLastPrint(new Date().toLocaleTimeString('th-TH'));
      toast({ kind: 'success', title: 'พิมพ์ทดสอบสำเร็จ', msg: 'ตรวจสอบใบเสร็จที่พิมพ์ออกมา' });
    } catch (err: any) {
      toast({ kind: 'warning', title: 'พิมพ์ไม่สำเร็จ', msg: err.message });
    } finally {
      setTesting(false);
    }
  };

  const StatusDot = ({ s }: { s: BridgeStatus | PrinterStatus }) => {
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
        <button onClick={() => checkStatus()} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 18px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface)', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          <Icon name="refresh" size={15} style={{ animation: bridge === 'checking' ? 'spin 1s linear infinite' : 'none' }} />
          รีเฟรชสถานะ
        </button>
      </div>

      {/* Connect section */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>เชื่อมต่อ Print Bridge</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 14 }}>
          ถ้าเครื่องปริ้นอยู่คนละเครื่อง ให้ใส่ IP ของเครื่องที่รัน print-server.js
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input
            value={urlInput}
            onChange={e => setUrlInput(e.target.value)}
            placeholder="http://localhost:3456"
            style={{ flex: 1, padding: '9px 12px', borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface-2)', fontSize: 14, fontFamily: 'monospace' }}
            onKeyDown={e => e.key === 'Enter' && connectBridge()}
          />
          <button
            onClick={connectBridge}
            disabled={connecting}
            style={{ padding: '9px 20px', borderRadius: 8, background: 'var(--color-accent)', color: 'var(--color-primary-700)', fontWeight: 600, fontSize: 14, cursor: connecting ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
          >
            {connecting ? 'กำลังเชื่อม...' : 'เชื่อมต่อ'}
          </button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 8 }}>
          เครื่องเดียวกับ printer: <code style={{ background: 'var(--color-surface-2)', padding: '1px 6px', borderRadius: 4 }}>http://localhost:3456</code>
          {' '}· เครื่องอื่นในร้าน: <code style={{ background: 'var(--color-surface-2)', padding: '1px 6px', borderRadius: 4 }}>http://[IP เครื่อง]:3456</code>
        </div>
      </div>

      {/* Bridge status card */}
      <div style={{ background: bridge === 'offline' ? 'var(--color-danger-50)' : 'var(--color-surface)', border: `1px solid ${bridge === 'offline' ? 'var(--color-danger-50)' : 'var(--color-border)'}`, borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: bridge === 'offline' ? 12 : 0 }}>
          <div style={{ width: 44, height: 44, borderRadius: 10, background: 'var(--color-surface-2)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <Icon name="server" size={22} color="var(--color-text-secondary)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
              <span style={{ fontWeight: 700, fontSize: 15 }}>Print Bridge ({bridgeUrl.replace('http://', '')})</span>
              <StatusDot s={bridge} />
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>สคริปต์ที่รันบนเครื่อง PC ร้าน — เชื่อม web app กับ printer</div>
          </div>
        </div>
        {bridge === 'offline' && (
          <div style={{ marginTop: 8, padding: '10px 14px', background: 'var(--color-surface)', borderRadius: 8, border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>วิธีเปิด Print Bridge:</div>
            <code style={{ fontSize: 12, color: 'var(--color-primary)', background: 'var(--color-surface-2)', padding: '4px 8px', borderRadius: 6, display: 'block' }}>
              node D:\POS\print-server.js
            </code>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 6 }}>เปิดไว้ตลอดเวลาที่ใช้งาน แล้วกด "รีเฟรชสถานะ"</div>
          </div>
        )}
      </div>

      {/* Printer card */}
      <div style={{ background: 'var(--color-surface)', border: `1px solid ${printer === 'offline' ? 'var(--color-danger-50)' : 'var(--color-border)'}`, borderRadius: 12, padding: 20, marginBottom: 28, boxShadow: 'var(--shadow-xs)' }}>
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
            disabled={testing || bridge === 'checking'}
            style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid var(--color-border)', background: testing ? 'var(--color-success-50)' : 'var(--color-surface-2)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6, cursor: testing ? 'default' : 'pointer', color: testing ? 'var(--color-success)' : 'inherit', opacity: bridge === 'offline' ? 0.5 : 1 }}
          >
            <Icon name={testing ? 'check' : 'print'} size={14} color={testing ? 'var(--color-success)' : 'currentColor'} />
            {testing ? 'กำลังพิมพ์...' : 'ทดสอบพิมพ์'}
          </button>
        </div>
      </div>

      {/* Settings */}
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, padding: 20, boxShadow: 'var(--shadow-xs)' }}>
        <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 4 }}>การตั้งค่าใบเสร็จ</div>
        <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 16 }}>ขนาดกระดาษ 80mm · พิมพ์อัตโนมัติหลังชำระเงิน</div>
        <button
          onClick={testPrint}
          disabled={testing || bridge === 'offline'}
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 8, background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', fontSize: 14, fontWeight: 500, cursor: bridge === 'offline' ? 'not-allowed' : 'pointer', opacity: bridge === 'offline' ? 0.5 : 1 }}
        >
          <Icon name="print" size={15} /> ทดสอบพิมพ์ใบเสร็จ
        </button>
      </div>
    </div>
  );
}
