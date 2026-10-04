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

## Security (since 2026-10)

Listening on loopback alone is **not** enough: any website open in the browser on
this PC can send requests to `127.0.0.1`. So every request must pass all four checks:

| Check | Rule | Otherwise |
|---|---|---|
| Host | `Host` is `127.0.0.1:<port>` or `localhost:<port>` (blocks DNS rebinding) | 421 |
| Origin | If `Origin` is sent it must be allow-listed. CORS headers are reflected for that origin only, never `*`. `Access-Control-Allow-Private-Network: true` is sent only to allowed origins | 403 |
| Token | `x-bridge-token` equals the shop token. **Required**: with no token configured the bridge answers 503 to everything | 401 / 503 |
| Body | `POST` / `PUT` must be `Content-Type: application/json` (forces a CORS preflight) | 415 |

`PUT /config` also rejects a printer `ip` that is not a literal IPv4 address and a `port` outside 1-65535.

**Allowed origins:** `https://cafe-pos-sable.vercel.app` by default. Add more (a custom
domain, a preview URL) with `BRIDGE_ALLOWED_ORIGINS=https://a.example,https://b.example`.
`BRIDGE_ALLOW_DEV_ORIGINS=1` adds `http://localhost:3000` / `:3108` for development.

**Shop token:** one shared secret per web deployment.

1. Generate it once: `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. Vercel → Project → Settings → Environment Variables: `BRIDGE_TOKEN=<value>` (Production), then redeploy.
   The app reads it from `/api/auth/bridge-token` (logged-in users only) and sends it as `x-bridge-token`.
3. On each POS PC, save the same value (one line, nothing else) to
   `%ProgramData%\cafe-pos-bridge\bridge-token.txt`
   (or `bridge\bridge-token.txt` beside `server.mjs` when running by hand). `BRIDGE_TOKEN` env overrides the file.
4. Restart the service (`nssm restart CafePosBridge`) or run `scripts\update-bridge-usb.bat` as admin.

The token file is git-ignored. Never commit it and never put it in a zip you share publicly.

**Rollout order** (so printing never stops): set `BRIDGE_TOKEN` on Vercel and deploy the
app first (old bridges ignore the header) → put `bridge-token.txt` on each PC → update
`server.mjs`. `update-bridge.ps1` (the 15-minute auto-update) holds back this version on
any PC that has no token file yet.

## Daily startup (after PC reboot)

```powershell
cd d:\POS
node bridge\server.mjs
```

Leave the window open. Bridge prints log lines on each print job.

Then open https://cafe-pos-sable.vercel.app in a browser **on this PC**.

For a no-console "install once, runs at boot" setup, see [installer/](installer/).

## Distributing to other shops

`bridge/installer/` contains a zero-config installer that ships bridge as a
Windows Service. Shop owners run `install.bat` as administrator once and never
think about it again. The bridge auto-discovers their printer by scanning the
local subnet for TCP 9100.

Build the zip with:

```powershell
pwsh bridge\installer\build.ps1
# -> bridge\dist\cafe-pos-bridge-v1.0.zip  (~33 MB)
```

Then upload to a GitHub Release or share directly.

## Verify

```powershell
$t = (Get-Content "$env:ProgramData\cafe-pos-bridge\bridge-token.txt" -Raw).Trim()
Invoke-WebRequest http://127.0.0.1:8080/status -Headers @{ 'x-bridge-token' = $t } -UseBasicParsing
```

Expect: `{"printer":true,"ip":"192.168.192.168"}`

## Tunnel mode (removed)

The Vercel `/api/print*` routes were deleted in the 2026-10 security update, and the
bridge now rejects any `Host` other than `127.0.0.1` / `localhost`. Exposing the bridge
through a tunnel is not supported. The browser must run on the bridge PC.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `bridge ไม่ตอบ` toast in the UI | Bridge not running. Open PowerShell and run `node bridge\server.mjs` |
| `bridge token not configured` (503) | `bridge-token.txt` missing or shorter than 24 chars. See "Shop token" above |
| `unauthorized` (401) | Token on the PC differs from `BRIDGE_TOKEN` on Vercel, or you are not logged in to the POS |
| `origin not allowed` (403) | The POS is opened from a URL that is not allow-listed. Add it with `BRIDGE_ALLOWED_ORIGINS` |
| `{"printer":false}` | Printer off, LAN cable unplugged, or wrong IP. Try `Test-NetConnection 192.168.192.168 -Port 9100` |
| Works on PC, not on phone | Expected — browser must be on the PC with the bridge. Use tunnel mode if you need remote |
| Browser console: "Failed to fetch" from vercel.app | You're not on the bridge PC, or bridge is down |
