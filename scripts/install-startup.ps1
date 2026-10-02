# Pasang auto-start Finance Bot saat login Windows (tanpa admin).
# Jalankan: powershell -ExecutionPolicy Bypass -File scripts\install-startup.ps1
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$startupDir = [Environment]::GetFolderPath("Startup")
$vbsPath = Join-Path $startupDir "FinanceBot.vbs"
$logPath = Join-Path $root "finance-bot.log"

if (-not (Test-Path -LiteralPath (Join-Path $root "package.json"))) {
  throw "package.json tidak ditemukan di $root. Jalankan script dari dalam folder project."
}

$node = (Get-Command node -ErrorAction Stop).Source
$tsx = Join-Path $root "node_modules\tsx\dist\cli.mjs"
if (-not (Test-Path -LiteralPath $tsx)) {
  throw "tsx tidak ditemukan di $tsx. Jalankan 'npm install' dulu."
}

# VBS menjalankan cmd tersembunyi: tunggu 15 detik (ping) lalu start node + tsx.
$content = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$root"
sh.Run "cmd /c ping -n 16 127.0.0.1 >nul & ""$node"" ""$tsx"" src\server.ts >> ""$logPath"" 2>&1", 0, False
"@

Set-Content -LiteralPath $vbsPath -Value $content -Encoding ASCII

Write-Host "Terpasang: $vbsPath"
Write-Host "Bot akan jalan otomatis (tanpa jendela) ~15 detik setelah kamu login."
Write-Host "Node:      $node"
Write-Host "Log:       $logPath"
Write-Host "Lepas:     scripts\uninstall-startup.ps1"
Write-Host "Catatan:   hanya saat login (bukan sebelum login). Butuh internet untuk Telegram."