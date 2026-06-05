$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\TinyDcBot"
$Node = Join-Path $ProjectRoot "runtime\node\node.exe"
$Dashboard = Join-Path $ProjectRoot "src\dashboardServer.js"
$DashboardUrl = "http://127.0.0.1:8787"

& (Join-Path $ProjectRoot "scripts\check-storage.ps1")

if (-not (Test-Path $Node)) {
    throw "Missing project-local Node: $Node"
}

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
    throw "Missing .env. The dashboard can open, but the Discord bot cannot run until .env exists."
}

$env:OLLAMA_MODELS = Join-Path $ProjectRoot "runtime\ollama\models"
$env:TINYDCBOT_DASHBOARD_PORT = "8787"
$env:TINYDCBOT_ALLOW_PATH_RUNTIME = ""

Start-Process -FilePath $DashboardUrl | Out-Null
& $Node $Dashboard
