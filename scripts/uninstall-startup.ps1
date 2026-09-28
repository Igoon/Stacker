# Hapus auto-start Finance Bot.
# Jalankan: powershell -ExecutionPolicy Bypass -File scripts\uninstall-startup.ps1
$ErrorActionPreference = "Stop"

$startupDir = [Environment]::GetFolderPath("Startup")
$vbsPath = Join-Path $startupDir "FinanceBot.vbs"

if (Test-Path -LiteralPath $vbsPath) {
  Remove-Item -LiteralPath $vbsPath -Force
  Write-Host "Dihapus: $vbsPath"
} else {
  Write-Host "Tidak ada auto-start terpasang."
}