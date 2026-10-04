# update-bridge.ps1 - sync the installed print-bridge service with the repo.
#
# Copies D:\POS\bridge\server.mjs into the NSSM service directory and restarts
# the CafePosBridge service ONLY when the file actually changed. Safe to run
# repeatedly - used both manually (update-bridge.bat) and by the
# CafePosBridgeAutoUpdate scheduled task.
#
# ASCII only - no Thai text, no chcp. (Thai + chcp 65001 breaks cmd.exe parsing
# on shop PCs; keep every bridge script pure ASCII.)

$ErrorActionPreference = 'Stop'

$svc     = 'CafePosBridge'
$dst     = Join-Path $env:ProgramData 'cafe-pos-bridge'
$src     = 'D:\POS\bridge\server.mjs'
$dstFile = Join-Path $dst 'server.mjs'
$nssm    = Join-Path $dst 'nssm.exe'

if (-not (Test-Path $src)) { Write-Host "[X] source missing: $src"; exit 1 }
if (-not (Test-Path $dst)) { Write-Host "[X] service dir missing: $dst (run installer first)"; exit 1 }

# Since the 2026-10 security update the bridge refuses every request without the
# shop token. Never install that version on a PC that has no token yet, or this
# auto-update would silently stop printing. Exit 0 so the scheduled task stays quiet.
$tokenFile = Join-Path $dst 'bridge-token.txt'
$needsToken = (Select-String -Path $src -Pattern 'bridge-token.txt' -SimpleMatch -Quiet)
$hasToken = (Test-Path $tokenFile) -and ((Get-Content $tokenFile -Raw).Trim().Length -ge 24)
if ($needsToken -and -not $hasToken) {
  Write-Host "[!] update held: $tokenFile missing (must equal BRIDGE_TOKEN on Vercel). See bridge\README.md"
  exit 0
}

# Skip the restart when nothing changed (keeps the 15-min task cheap + silent).
$same = $false
if (Test-Path $dstFile) {
  $h1 = (Get-FileHash $src     -Algorithm SHA256).Hash
  $h2 = (Get-FileHash $dstFile -Algorithm SHA256).Hash
  $same = ($h1 -eq $h2)
}
if ($same) { Write-Host "[=] bridge already up to date"; exit 0 }

Copy-Item $src $dstFile -Force
Write-Host "[1] copied server.mjs -> $dstFile"

if (Test-Path $nssm) {
  & $nssm restart $svc | Out-Null
} else {
  Restart-Service $svc -Force
}
Write-Host "[2] restarted service $svc"

Start-Sleep -Seconds 3
try {
  $hdr = @{}
  if ($hasToken) { $hdr['x-bridge-token'] = (Get-Content $tokenFile -Raw).Trim() }
  $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8080/status' -Headers $hdr -TimeoutSec 5
  Write-Host "[3] status: printer=$($r.printer) ip=$($r.ip)"
} catch {
  Write-Host "[3] status check skipped: $($_.Exception.Message)"
}
exit 0
