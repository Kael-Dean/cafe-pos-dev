/**
 * Local print bridge — run this on the POS machine.
 * The web app (even on HTTPS/Vercel) calls http://localhost:3456/print
 * and this server forwards the job to the Epson printer via TCP port 9100.
 *
 * Usage: node print-server.js
 */

const http = require('http');
const net  = require('net');

const PRINTER_IP   = '192.168.1.129';
const PRINTER_PORT = 9100;
const LISTEN_PORT  = 3456;

// Thai Unicode (U+0E00–U+0E7F) → TIS-620 (0xA0–0xFF)
function toTIS620(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.charCodeAt(0);
    if (cp >= 0x0e00 && cp <= 0x0e7f) bytes.push(cp - 0x0e00 + 0xa0);
    else if (cp < 0x80)               bytes.push(cp);
    else                               bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

const ESC = 0x1b, GS = 0x1d, LF = 0x0a;
const cmd  = (...b) => Buffer.from(b);
const line = (s)    => Buffer.concat([toTIS620(s), Buffer.from([LF])]);

function buildESCPOS(data) {
  const W    = 32;
  const dash = '-'.repeat(W);
  const fmt  = (n) => Number(n).toFixed(2);
  const lr   = (l, r) => {
    const left = l.substring(0, W - r.length - 1);
    return left + ' '.repeat(Math.max(1, W - left.length - r.length)) + r;
  };

  const parts = [
    cmd(ESC, 0x40),       // initialize
    cmd(ESC, 0x74, 0x15), // Thai Code 2 (eThai 1, TIS-620 compatible)
    cmd(ESC, 0x61, 0x01), // center
    cmd(GS,  0x21, 0x10), // double height
    line(data.storeName),
    cmd(GS,  0x21, 0x00), // normal
    line('ออเดอร์ #' + data.orderNumber),
    line(new Date().toLocaleString('th-TH')),
    line(dash),
    cmd(ESC, 0x61, 0x00), // left
  ];

  for (const item of data.items) {
    parts.push(line(lr(item.name, fmt(item.qty * item.unitPrice))));
    parts.push(line('  ' + item.qty + ' x ' + fmt(item.unitPrice)));
    for (const mod of (item.mods ?? [])) parts.push(line('  + ' + mod));
  }

  parts.push(
    line(dash),
    line(lr('รวม', fmt(data.subtotal))),
    cmd(ESC, 0x45, 0x01), // bold on
    line(lr('รวมทั้งสิ้น', fmt(data.total))),
    cmd(ESC, 0x45, 0x00), // bold off
    line('ชำระ: ' + data.paymentLabel),
    line(dash),
    cmd(ESC, 0x61, 0x01), // center
    line('ขอบคุณที่ใช้บริการ'),
    Buffer.from([LF, LF, LF]),
    cmd(GS, 0x56, 0x42, 0x03), // full cut
  );

  return Buffer.concat(parts);
}

function sendToPrinter(receipt) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    socket.setTimeout(5000);
    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(receipt, (err) => {
        socket.destroy();
        err ? reject(err) : resolve();
      });
    });
    socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
    socket.on('error', reject);
  });
}

function checkPrinter() {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(2000);
    socket.connect(PRINTER_PORT, PRINTER_IP, () => { socket.destroy(); resolve(true); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.on('error',   () => { socket.destroy(); resolve(false); });
  });
}

function buildTestPage() {
  return buildESCPOS({
    storeName:    'ร้านตะวันอ้อมข้าว',
    orderNumber:  'TEST',
    items:        [{ name: 'ทดสอบการพิมพ์', qty: 1, unitPrice: 0, mods: [] }],
    subtotal:     0,
    total:        0,
    paymentLabel: 'ทดสอบ',
  });
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin',          '*');
  res.setHeader('Access-Control-Allow-Methods',         'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers',         'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // GET /status — check if printer is reachable
  if (req.method === 'GET' && req.url === '/status') {
    checkPrinter().then(online => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bridge: true, printer: online, ip: PRINTER_IP }));
    });
    return;
  }

  // POST /test — print a test page
  if (req.method === 'POST' && req.url === '/test') {
    sendToPrinter(buildTestPage())
      .then(() => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true })); })
      .catch(err => { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: err.message })); });
    return;
  }

  if (req.method !== 'POST' || req.url !== '/print') {
    res.writeHead(404); res.end(); return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const data    = JSON.parse(body);
      const receipt = buildESCPOS(data);
      await sendToPrinter(receipt);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
      console.log(`[${new Date().toLocaleTimeString()}] พิมพ์สำเร็จ ออเดอร์ #${data.orderNumber}`);
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: err.message }));
      console.error('print error:', err.message);
    }
  });
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`Print bridge รันอยู่ที่ http://localhost:${LISTEN_PORT}`);
  console.log(`Printer: ${PRINTER_IP}:${PRINTER_PORT}`);
});
