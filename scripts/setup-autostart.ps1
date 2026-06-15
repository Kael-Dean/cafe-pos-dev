# setup-autostart.ps1
# รันสคริปต์นี้ครั้งเดียวบนเครื่องที่ต่อ printer
# เครื่องจะรัน print-server.js อัตโนมัติทุกครั้งที่เปิดเครื่อง

$NodePath   = (Get-Command node -ErrorAction Stop).Source
$ScriptPath = "D:\POS\print-server.js"
$TaskName   = "POS Print Bridge"

$action  = New-ScheduledTaskAction -Execute $NodePath -Argument $ScriptPath -WorkingDirectory "D:\POS"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Hours 0) `
    -RestartCount 999 `
    -RestartInterval (New-TimeSpan -Minutes 1) `
    -StartWhenAvailable

Register-ScheduledTask `
    -TaskName   $TaskName `
    -Action     $action `
    -Trigger    $trigger `
    -Settings   $settings `
    -RunLevel   Highest `
    -Force | Out-Null

# รันทันทีโดยไม่ต้องรีบูต
Start-ScheduledTask -TaskName $TaskName

Write-Host ""
Write-Host "✓ ตั้งค่าสำเร็จ! Print bridge จะรันอัตโนมัติทุกครั้งที่เปิดเครื่อง" -ForegroundColor Green
Write-Host ""

# แสดง IP ของเครื่องนี้เพื่อใช้ตั้งค่าในเครื่องอื่น
$ips = Get-NetIPAddress -AddressFamily IPv4 |
       Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
       Select-Object -ExpandProperty IPAddress
Write-Host "IP เครื่องนี้ (ใช้ตั้งค่าในเครื่องอื่น):" -ForegroundColor Cyan
foreach ($ip in $ips) { Write-Host "  http://${ip}:3456" -ForegroundColor Yellow }
Write-Host ""
Write-Host "กด Enter เพื่อปิด..."
Read-Host
