# Build cafe-pos-bridge installer package.
#
# Usage:  pwsh bridge\installer\build.ps1 [-Version 1.0]
#
# Output: bridge\dist\cafe-pos-bridge-v<Version>.zip
#
# Bundles:
#   - bridge.exe  (portable node.exe, fetched from nodejs.org)
#   - server.mjs  (copied from ../server.mjs)
#   - nssm.exe    (fetched from nssm.cc)
#   - install.bat / uninstall.bat / README.txt  (from this folder)

param(
    [string]$Version    = '1.0',
    [string]$NodeVersion = 'v24.15.0'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$bridge  = Split-Path -Parent $here
$repo    = Split-Path -Parent $bridge
$build   = Join-Path $bridge 'dist-build'
$cache   = Join-Path $here   '.cache'
$pkgName = 'cafe-pos-bridge'
$pkg     = Join-Path $build $pkgName
$distDir = Join-Path $bridge 'dist'
$zip     = Join-Path $distDir "$pkgName-v$Version.zip"

if (Test-Path $build) { Remove-Item $build -Recurse -Force }
New-Item -ItemType Directory -Path $pkg     -Force | Out-Null
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
New-Item -ItemType Directory -Path $cache   -Force | Out-Null

function Download-WithRetry($url, $dest, $tries = 3) {
    for ($i = 1; $i -le $tries; $i++) {
        try { Invoke-WebRequest $url -OutFile $dest -UseBasicParsing; return }
        catch {
            Write-Host "    attempt $i/$tries failed: $($_.Exception.Message)"
            if ($i -eq $tries) { throw }
            Start-Sleep -Seconds ($i * 2)
        }
    }
}

Write-Host "Building $pkgName v$Version (Node $NodeVersion)" -ForegroundColor Cyan

# 1. node.exe (renamed bridge.exe)
$cachedNode = Join-Path $cache "node-$NodeVersion.exe"
if (-not (Test-Path $cachedNode)) {
    $nodeZip = Join-Path $cache "node-$NodeVersion.zip"
    $nodeUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
    Write-Host "  [1/4] Downloading $nodeUrl"
    Download-WithRetry $nodeUrl $nodeZip
    Expand-Archive $nodeZip -DestinationPath (Join-Path $cache 'node-extract') -Force
    $extractedNode = Get-ChildItem (Join-Path $cache 'node-extract') -Directory | Select-Object -First 1
    Copy-Item (Join-Path $extractedNode.FullName 'node.exe') $cachedNode
    Remove-Item $nodeZip, (Join-Path $cache 'node-extract') -Recurse -Force
} else { Write-Host "  [1/4] node.exe cached" }
Copy-Item $cachedNode (Join-Path $pkg 'bridge.exe')

# 2. nssm.exe
$cachedNssm = Join-Path $cache 'nssm.exe'
if (-not (Test-Path $cachedNssm)) {
    $nssmZip = Join-Path $cache 'nssm.zip'
    Write-Host "  [2/4] Downloading NSSM (nssm.cc — site is sometimes flaky)"
    Download-WithRetry 'https://nssm.cc/release/nssm-2.24.zip' $nssmZip
    Expand-Archive $nssmZip -DestinationPath (Join-Path $cache 'nssm-extract') -Force
    $nssmExe = Get-ChildItem (Join-Path $cache 'nssm-extract') -Filter 'nssm.exe' -Recurse |
        Where-Object { $_.FullName -match 'win64' } | Select-Object -First 1
    Copy-Item $nssmExe.FullName $cachedNssm
    Remove-Item $nssmZip, (Join-Path $cache 'nssm-extract') -Recurse -Force
} else { Write-Host "  [2/4] nssm.exe cached" }
Copy-Item $cachedNssm (Join-Path $pkg 'nssm.exe')

# 3. server.mjs + installer scripts
Write-Host "  [3/4] Copying bridge sources"
Copy-Item (Join-Path $bridge 'server.mjs')  (Join-Path $pkg 'server.mjs')
Copy-Item (Join-Path $here   'install.bat') (Join-Path $pkg 'install.bat')
Copy-Item (Join-Path $here   'uninstall.bat')(Join-Path $pkg 'uninstall.bat')
Copy-Item (Join-Path $here   'README.txt')  (Join-Path $pkg 'README.txt')

# 4. Zip
Write-Host "  [4/4] Compressing to $zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path "$pkg\*" -DestinationPath $zip -CompressionLevel Optimal

$size = (Get-Item $zip).Length
Write-Host ""
Write-Host "Done. $zip ($([math]::Round($size/1MB,1)) MB)" -ForegroundColor Green
Write-Host ""
Write-Host "Distribute by:"
Write-Host "  - Upload to GitHub Release (gh release create v$Version $zip)"
Write-Host "  - Or share via Google Drive / LINE / direct download"
