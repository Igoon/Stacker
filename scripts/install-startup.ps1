# Pasang auto-start Finance Bot saat login Windows.
# Jalankan: powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$startupDir = [Environment]::GetFolderPath("Startup")
$vbsPath = Join-Path $startupDir "FinanceBot.vbs"
$logPath = Join-Path $env:USERPROFILE "finance-bot.log"

if (-not (Test-Path -LiteralPath (Join-Path $root "package.json"))) {
  throw "package.json tidak ditemukan di $root. Jalankan script dari dalam folder project."
}

$content = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$root"
sh.Run "cmd /c npm start >> ""$logPath"" 2>&1", 0, False
"@

Set-Content -LiteralPath $vbsPath -Value $content -Encoding ASCII

Write-Host "Terpasang: $vbsPath"
Write-Host "Bot akan jalan otomatis (tanpa jendela) saat kamu login."
Write-Host "Log:      $logPath"
Write-Host "Hentikan: scripts\uninstall-startup.ps1"