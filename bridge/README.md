# Print Bridge

Local HTTP server on the PC that talks to the LAN-connected printer.
The browser (loaded from `cafe-pos-sable.vercel.app`) calls it **directly** —
no tunnel, no Vercel roundtrip.

```
[Browser on PC]  https://cafe-pos-sable.vercel.app
       │
       │ fetch('http://127.0.0.1:8080/print')
       │ (Chrome treats http://127.0.0.1 as secure — no mixed-content block)
       ▼
[bridge/server.mjs  127.0.0.1:8080]
       │ TCP 9100
       ▼
[EPSON TM-T82X  192.168.192.168]
```

## Requirements

- The browser **must run on the same PC** as the bridge. The bridge binds `127.0.0.1` only.
- Chrome / Edge / any Chromium-based browser. Firefox also treats `127.0.0.1` as secure.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET    | `/status` | `{ printer: bool, ip }` — is the printer reachable on TCP 9100 |
| GET    | `/config` | returns `printer-config.json` |
| PUT    | `/config` | merge-patch + persist `printer-config.json` |
| GET    | `/scan`   | probe `<subnet>.1–254` on TCP 9100, return found IPs |
| POST   | `/print`  | receive `PrintBody`, build ESC/POS, send to printer |

CORS: `Access-Control-Allow-Origin: *` (any origin) — safe because bridge listens on loopback only.

## Daily startup (after PC reboot)

```powershell
cd d:\POS
node bridge\server.mjs
```

Leave the window open. Bridge prints log lines on each print job.

Then open https://cafe-pos-sable.vercel.app in a browser **on this PC**.

## Verify

```powershell
Invoke-WebRequest http://127.0.0.1:8080/status -UseBasicParsing
```

Expect: `{"printer":true,"ip":"192.168.192.168"}`

## Optional: auth + tunnel mode

If you ever want to expose the bridge over the internet (e.g. print from a phone):

```powershell
$env:BRIDGE_TOKEN = '<random secret>'
node bridge\server.mjs
```

Then run `cloudflared tunnel --url http://localhost:8080` and update the
Vercel env vars `PRINT_BRIDGE_URL` + `PRINT_BRIDGE_TOKEN`. The Vercel
`/api/print` route still supports this fallback path. Browser-direct mode
is the default and is faster.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bridge ไม่ตอบ` toast in the UI | Bridge not running. Open PowerShell and run `node bridge\server.mjs` |
| `{"printer":false}` | Printer off, LAN cable unplugged, or wrong IP. Try `Test-NetConnection 192.168.192.168 -Port 9100` |
| Works on PC, not on phone | Expected — browser must be on the PC with the bridge. Use tunnel mode if you need remote |
| Browser console: "Failed to fetch" from vercel.app | You're not on the bridge PC, or bridge is down |
