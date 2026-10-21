<#
.SYNOPSIS
  Sync เฉพาะไฟล์ที่แก้จาก dev (d:\POS-dev) ไปเว็บหลัก (d:\POS) แล้ว push ขึ้น cafe-pos
  ใช้คู่กับ workflow "ขึ้นเว็บหลัก" ใน CLAUDE.md

.DESCRIPTION
  1. ตรวจว่าไฟล์ที่ระบุมีอยู่จริงใน dev
  2. copy ไฟล์เหล่านั้นไปทับใน d:\POS (ตาม path เดิม)
  0. (editions monorepo) ถ้า dev เป็น monorepo แต่ d:\POS ยังเป็น layout เก่า และมีไฟล์ใน apps/ หรือ
     packages/ -> หยุดทันที ไม่แตะ d:\POS (ดู docs/EDITIONS.md §7)
  3. รัน `npm run typecheck` เป็นด่านเช็ค "ไม่ error" (ข้ามได้ด้วย -SkipBuild) —
     ที่ root ของ d:\POS ถ้า d:\POS เป็น monorepo แล้ว (turbo: core + ทุก edition), ไม่งั้นที่ d:\POS\app
  4. ถ้าผ่าน -> commit เฉพาะไฟล์เหล่านั้น (ใช้ index2 workaround) -> push origin main
     ถ้า typecheck ไม่ผ่าน -> หยุด ไม่ push (ไฟล์ถูก copy ไปแล้วแต่ยังไม่ commit)

.EXAMPLE
  # หลัง migrate d:\POS เป็น monorepo แล้ว (path ใหม่)
  .\sync-to-main.ps1 -Files "packages/pos-core/components/screens/pos.tsx","packages/pos-core/components/screens/membership-modal.tsx" -Message "feat(pos): quick สมัครสมาชิก button"

.EXAMPLE
  # layout เก่า (ก่อน migrate) — ใช้ได้เฉพาะ path app/... ที่ยังมีใน dev
  .\sync-to-main.ps1 -Files "app/src/components/screens/pos.tsx" -Message "fix(pos): ..."

.EXAMPLE
  .\sync-to-main.ps1 -Files "api-handoff (9).md" -Message "docs: update handoff" -SkipBuild
#>
param(
  [Parameter(Mandatory = $true)]
  [string[]]$Files,

  [string]$Message = "chore: sync from dev",

  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Dev       = "d:\POS-dev"
$Main      = "d:\POS"
$EmptyTree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

function Fail($msg) { Write-Host "`n[X] $msg" -ForegroundColor Red; exit 1 }
function Ok($msg)   { Write-Host "[OK] $msg" -ForegroundColor Green }

# --- 0. layout guard (editions monorepo, docs/EDITIONS.md) ---
# dev ย้ายเป็น monorepo แล้ว (apps/cafe, apps/boardgame, packages/pos-core) แต่ d:\POS อาจยังเป็น
# layout เก่า (app/). ไฟล์ใน packages/pos-core ใช้ import แบบ @pos/core/... ซึ่ง app/ เก่า resolve ไม่ได้
# -> copy ข้าม layout = build พัง. หยุดก่อนแตะ d:\POS จนกว่าจะ migrate d:\POS ตาม EDITIONS.md §7
$DevIsMonorepo  = Test-Path (Join-Path $Dev  "packages\pos-core")
$MainIsMonorepo = Test-Path (Join-Path $Main "packages\pos-core")
if ($DevIsMonorepo -and -not $MainIsMonorepo) {
  $newLayout = $Files | Where-Object { $_ -match '^(apps|packages)[\\/]' }
  if ($newLayout) {
    Fail ("d:\POS ยังเป็น layout เก่า (app/) แต่ไฟล์ที่จะ sync อยู่ใน layout ใหม่:`n  " + ($newLayout -join "`n  ") +
          "`nmigrate d:\POS เป็น monorepo ก่อน (docs/EDITIONS.md §7) — ห้าม copy ข้าม layout")
  }
}

# --- 1. ตรวจไฟล์ต้นทางมีจริง ---
foreach ($f in $Files) {
  $src = Join-Path $Dev $f
  if (-not (Test-Path $src)) { Fail "ไม่พบไฟล์ใน dev: $f" }
}

# --- 2. copy ไฟล์ dev -> main ---
foreach ($f in $Files) {
  $src    = Join-Path $Dev $f
  $dst    = Join-Path $Main $f
  $dstDir = Split-Path $dst -Parent
  if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
  Copy-Item -Path $src -Destination $dst -Force
  Write-Host "  copied: $f"
}
Ok "copy ไฟล์ไป d:\POS ครบ ($($Files.Count) ไฟล์)"

# --- 3. typecheck ใน main (monorepo: root = ทุก workspace ผ่าน turbo; layout เก่า: app/) ---
if (-not $SkipBuild) {
  $TcDir = if ($MainIsMonorepo) { $Main } else { Join-Path $Main "app" }
  Write-Host "`nรัน typecheck ใน $TcDir ..." -ForegroundColor Cyan
  Push-Location $TcDir
  npm run typecheck
  $tc = $LASTEXITCODE
  Pop-Location
  if ($tc -ne 0) {
    Fail "typecheck ล้มเหลว — ยกเลิกการ push (ไฟล์ถูก copy ไป d:\POS แล้วแต่ยังไม่ commit). แก้ให้ผ่านก่อนแล้วรันใหม่"
  }
  Ok "typecheck ผ่าน"
} else {
  Write-Host "(ข้าม typecheck ตาม -SkipBuild)" -ForegroundColor Yellow
}

# --- 4. commit + push ใน main (index2 workaround) ---
Set-Location $Main
$env:GIT_INDEX_FILE = ".git/index2"
git read-tree HEAD
foreach ($f in $Files) { git add -- $f }

$TREE = (git write-tree).Trim()        # ต้องรันก่อนลบ index2
if ([string]::IsNullOrWhiteSpace($TREE) -or $TREE -eq $EmptyTree) {
  Remove-Item .git/index2 -ErrorAction SilentlyContinue
  Remove-Item env:GIT_INDEX_FILE -ErrorAction SilentlyContinue
  Fail "write-tree ให้ค่าผิดปกติ ($TREE) — ยกเลิกเพื่อความปลอดภัย ไม่แตะ branch"
}

$PARENT = (git rev-parse HEAD).Trim()
$COMMIT = (git commit-tree $TREE -p $PARENT -m $Message).Trim()
"$COMMIT" | Out-File .git/refs/heads/main -Encoding ascii -NoNewline
Remove-Item .git/index2 -ErrorAction SilentlyContinue
Remove-Item env:GIT_INDEX_FILE -ErrorAction SilentlyContinue

git push origin main
"$COMMIT" | Out-File .git/refs/remotes/origin/main -Encoding ascii -NoNewline

Ok "DONE -> commit $COMMIT push ขึ้น cafe-pos แล้ว (Vercel จะ deploy เว็บหลักอัตโนมัติ)"
