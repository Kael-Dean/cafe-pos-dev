# Print Bridge

Local HTTP server that lets the Vercel-hosted POS print to a LAN printer on this PC.

```
[cafe-pos-sable.vercel.app]
        │ POST /api/print  (server has PRINT_BRIDGE_URL set)
        ▼
[Cloudflare Tunnel  https://*.trycloudflare.com]
        │
        ▼
[bridge/server.mjs  127.0.0.1:8080]
        │ TCP 9100
        ▼
[EPSON TM-T82X  192.168.192.168]
```

## First-time setup

Already done:

- `bridge/server.mjs` — the HTTP server (Node, no deps)
- `bridge/cloudflared.exe` — downloaded to repo (gitignored)
- `bridge/.token` — auto-generated random secret (gitignored)
- Vercel route `app/src/app/api/print/route.ts` honors `PRINT_BRIDGE_URL` + `PRINT_BRIDGE_TOKEN`

You need to set these on Vercel **once**:

| Env var | Value |
|---|---|
| `PRINT_BRIDGE_URL` | the tunnel URL (changes each restart unless using a named tunnel) |
| `PRINT_BRIDGE_TOKEN` | contents of `bridge/.token` |

Set at https://vercel.com → project → Settings → Environment Variables → Production. Then redeploy.

## Daily startup (after PC reboot)

Open two PowerShell windows.

**Window 1 — bridge:**

```powershell
cd d:\POS
$env:BRIDGE_TOKEN = Get-Content bridge\.token -Raw
node bridge\server.mjs
```

**Window 2 — tunnel:**

```powershell
cd d:\POS
.\bridge\cloudflared.exe tunnel --url http://localhost:8080 --no-autoupdate
```

Watch for a line like:

```
https://xxxxx-xxxxx-xxxxx-xxxxx.trycloudflare.com
```

If that URL is **different from before**, update `PRINT_BRIDGE_URL` on Vercel and redeploy. To avoid this churn, see "Permanent URL" below.

## Verify

```powershell
$token = Get-Content d:\POS\bridge\.token -Raw
$url = '<tunnel url>'
Invoke-WebRequest "$url/status" -Headers @{'x-bridge-token' = $token} -UseBasicParsing
```

Expect: `{"printer":true,"ip":"192.168.192.168"}`

## Permanent URL (optional, recommended)

Free trycloudflare.com URLs are temporary. For a fixed URL:

1. Sign up at https://dash.cloudflare.com (free)
2. Add a domain (or buy one cheap) and point it at Cloudflare
3. `cloudflared tunnel login`
4. `cloudflared tunnel create cafe-pos-print`
5. `cloudflared tunnel route dns cafe-pos-print print.yourdomain.com`
6. Replace daily startup with: `cloudflared tunnel run cafe-pos-print`

Then `PRINT_BRIDGE_URL=https://print.yourdomain.com` never changes.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `{"printer":false}` from bridge | Check printer powered on, LAN cable, `Test-NetConnection 192.168.192.168 -Port 9100` |
| Vercel shows offline but bridge `/status` returns true | `PRINT_BRIDGE_URL` not set on Vercel, or wrong URL, or missing redeploy |
| 401 unauthorized | `PRINT_BRIDGE_TOKEN` on Vercel doesn't match `bridge/.token` |
| Tunnel disconnects often | Free trycloudflare.com is best-effort. Use named tunnel for production |
