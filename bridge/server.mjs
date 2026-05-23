#!/usr/bin/env node
// Print bridge — receives JSON from Vercel, sends ESC/POS to local LAN printer.
// Run on the PC that has the printer cable. Expose via cloudflared tunnel.
//
//   node bridge/server.mjs
//
// Env:
//   BRIDGE_PORT          default 8080
//   BRIDGE_TOKEN         if set, require header x-bridge-token to match
//   PRINTER_IP           overrides printer-config.json ip
//   PRINTER_PORT         overrides printer-config.json port (default 9100)
//   PRINTER_CONFIG_PATH  default ./app/printer-config.json (relative to repo root)

import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const PORT         = Number(process.env.BRIDGE_PORT ?? 8080);
const TOKEN        = process.env.BRIDGE_TOKEN ?? null;
const CONFIG_PATH  = process.env.PRINTER_CONFIG_PATH
  ?? path.join(REPO_ROOT, 'app', 'printer-config.json');

function loadConfig() {
  let base = {};
  try { base = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  return {
    storeName:    base.storeName    ?? 'ร้าน',
    storeAddress: base.storeAddress,
    storeTaxId:   base.storeTaxId,
    storeBranch:  base.storeBranch,
    ip:   process.env.PRINTER_IP   ?? base.ip   ?? '192.168.192.168',
    port: Number(process.env.PRINTER_PORT ?? base.port ?? 9100),
  };
}

/* ── ESC/POS builder (mirrors app/src/app/api/print/route.ts) ───── */

function toTIS620(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.charCodeAt(0);
    if (cp >= 0x0e00 && cp <= 0x0e7f) bytes.push(cp - 0x0e00 + 0xa0);
    else if (cp < 0x80) bytes.push(cp);
    else bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
const cmd  = (...b) => Buffer.from(b);
const line = (s)    => Buffer.concat([toTIS620(s), Buffer.from([LF])]);

const W = 42;
const dash = '-'.repeat(W);
const leftRight = (l, r) => {
  const left = l.substring(0, W - r.length - 1);
  return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r;
};
const center = (s) => {
  const pad = Math.max(0, Math.floor((W - s.length) / 2));
  return ' '.repeat(pad) + s;
};
const fmt2 = (n) => Number(n).toFixed(2);

function buildESCPOS(data) {
  const hasTaxInfo = !!(data.buyerName || data.invoiceNo || data.storeTaxId);
  const preVat = data.subtotal;
  const vatAmt = data.vat ?? Math.round(data.subtotal * 0.07);

  const parts = [
    cmd(ESC, 0x40),
    cmd(ESC, 0x74, 0x15),
    cmd(ESC, 0x61, 0x01),
    cmd(GS,  0x21, 0x10),
    line(data.storeName),
    cmd(GS,  0x21, 0x00),
    line(hasTaxInfo ? 'ใบเสร็จรับเงิน/ใบกำกับภาษี' : 'ใบเสร็จรับเงิน'),
    line(center('ต้นฉบับ')),
    line(dash),
    cmd(ESC, 0x61, 0x00),
  ];

  if (data.storeAddress) parts.push(line(data.storeAddress));
  if (data.storeTaxId)   parts.push(line(`ผู้เสียภาษี: ${data.storeTaxId}`));
  if (data.storeBranch)  parts.push(line(data.storeBranch));

  if (data.buyerName) {
    parts.push(line(dash));
    parts.push(line('ผู้ซื้อ:'));
    parts.push(line(data.buyerName));
    if (data.buyerAddress) parts.push(line(data.buyerAddress));
    if (data.buyerTaxId)   parts.push(line(`ผู้เสียภาษี: ${data.buyerTaxId}`));
    if (data.buyerBranch)  parts.push(line(data.buyerBranch));
  }

  parts.push(line(dash));
  if (data.invoiceNo) parts.push(line(`เลขที่: ${data.invoiceNo}`));
  parts.push(line(`ออเดอร์: #${data.orderNumber}`));
  parts.push(line(new Date().toLocaleString('th-TH')));
  parts.push(line(dash));

  parts.push(line(leftRight('รายการ', 'จำนวนเงิน')));
  parts.push(line(dash));

  for (const item of data.items) {
    parts.push(line(leftRight(item.name, fmt2(item.qty * item.unitPrice))));
    parts.push(line(`  ${item.qty} x ${fmt2(item.unitPrice)}`));
    for (const mod of item.mods ?? []) parts.push(line(`  + ${mod}`));
  }

  parts.push(line(dash));
  parts.push(line(leftRight('มูลค่าก่อนภาษี', fmt2(preVat))));
  parts.push(line(leftRight('ภาษีมูลค่าเพิ่ม 7%', fmt2(vatAmt))));
  parts.push(line(dash));
  parts.push(cmd(ESC, 0x45, 0x01));
  parts.push(line(leftRight('รวมทั้งสิ้น', `${fmt2(data.total)} B`)));
  parts.push(cmd(ESC, 0x45, 0x00));
  parts.push(line(`ชำระ: ${data.paymentLabel}`));

  if (data.cashGiven != null) {
    parts.push(line(leftRight('รับเงิน', fmt2(data.cashGiven))));
    parts.push(line(leftRight('เงินทอน', fmt2(data.cashGiven - data.total))));
  }

  parts.push(line(dash));
  parts.push(cmd(ESC, 0x61, 0x01));
  parts.push(line('ลงชื่อผู้รับเงิน ......................'));
  parts.push(line(''));
  parts.push(line('ขอบคุณที่ใช้บริการ'));
  parts.push(Buffer.from([LF, LF, LF]));
  parts.push(cmd(GS, 0x56, 0x42, 0x03));

  return Buffer.concat(parts);
}

/* ── TCP printer I/O ─────────────────────────────────────────────── */

function checkPrinter(ip, port) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(2000);
    s.connect(port, ip, () => { s.destroy(); resolve(true); });
    s.on('timeout', () => { s.destroy(); resolve(false); });
    s.on('error',   () => { s.destroy(); resolve(false); });
  });
}

function sendToPrinter(ip, port, buf) {
  return new Promise((resolve, reject) => {
    const s = new net.Socket();
    s.setTimeout(5000);
    s.connect(port, ip, () => {
      s.write(buf, (err) => { s.destroy(); err ? reject(err) : resolve(); });
    });
    s.on('timeout', () => { s.destroy(); reject(new Error('timeout')); });
    s.on('error',   reject);
  });
}

function probeHost(ip, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    s.setTimeout(timeoutMs);
    s.connect(port, ip, () => { s.destroy(); resolve(ip); });
    s.on('timeout', () => { s.destroy(); resolve(null); });
    s.on('error',   () => { s.destroy(); resolve(null); });
  });
}

async function scanSubnet(subnet, port) {
  const candidates = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
  const found = [];
  for (let i = 0; i < candidates.length; i += 30) {
    const batch = candidates.slice(i, i + 30);
    const results = await Promise.all(batch.map((ip) => probeHost(ip, port)));
    found.push(...results.filter((r) => r !== null));
  }
  return found;
}

function saveConfig(patch) {
  let current = {};
  try { current = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); } catch {}
  const updated = {
    ...current,
    ...(patch.ip           !== undefined ? { ip: String(patch.ip).trim() }                  : {}),
    ...(patch.port         !== undefined ? { port: Number(patch.port) }                     : {}),
    ...(patch.storeName    !== undefined ? { storeName: String(patch.storeName).trim() }    : {}),
    ...(patch.storeAddress !== undefined ? { storeAddress: patch.storeAddress ?? null }     : {}),
    ...(patch.storeTaxId   !== undefined ? { storeTaxId:   patch.storeTaxId   ?? null }     : {}),
    ...(patch.storeBranch  !== undefined ? { storeBranch:  patch.storeBranch  ?? null }     : {}),
  };
  if (!updated.ip || typeof updated.ip !== 'string') throw new Error('IP ไม่ถูกต้อง');
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf8');
  return updated;
}

/* ── HTTP server ─────────────────────────────────────────────────── */

function json(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-bridge-token',
  });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { chunks += c; if (chunks.length > 1_000_000) reject(new Error('body too large')); });
    req.on('end',  () => resolve(chunks));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (TOKEN && req.headers['x-bridge-token'] !== TOKEN) {
    return json(res, 401, { ok: false, error: 'unauthorized' });
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      const cfg = loadConfig();
      const online = await checkPrinter(cfg.ip, cfg.port);
      return json(res, 200, { printer: online, ip: cfg.ip });
    }

    if (req.method === 'POST' && url.pathname === '/print') {
      const raw = await readBody(req);
      const body = JSON.parse(raw);
      const cfg = loadConfig();
      const receipt = buildESCPOS({
        storeName:    cfg.storeName,
        storeAddress: cfg.storeAddress,
        storeTaxId:   cfg.storeTaxId,
        storeBranch:  cfg.storeBranch,
        ...body,
      });
      await sendToPrinter(cfg.ip, cfg.port, receipt);
      console.log(`[print] ok  order=${body.orderNumber}  items=${body.items?.length ?? 0}`);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'GET' && url.pathname === '/config') {
      return json(res, 200, loadConfig());
    }

    if (req.method === 'PUT' && url.pathname === '/config') {
      const raw = await readBody(req);
      const patch = JSON.parse(raw);
      const updated = saveConfig(patch);
      console.log(`[config] saved  ip=${updated.ip}  store=${updated.storeName}`);
      return json(res, 200, { ok: true, ...updated });
    }

    if (req.method === 'GET' && url.pathname === '/scan') {
      const cfg = loadConfig();
      const parts = cfg.ip.split('.');
      const subnet = parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}` : '192.168.192';
      const found = await scanSubnet(subnet, cfg.port);
      return json(res, 200, { found, subnet });
    }

    return json(res, 404, { ok: false, error: 'not found' });
  } catch (err) {
    console.error('[error]', err.message);
    return json(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  const cfg = loadConfig();
  console.log(`Print bridge listening on http://127.0.0.1:${PORT}`);
  console.log(`Printer: ${cfg.ip}:${cfg.port}`);
  console.log(`Auth:    ${TOKEN ? 'token required' : 'OPEN (no token)'}`);
  console.log(`Config:  ${CONFIG_PATH}`);
});
