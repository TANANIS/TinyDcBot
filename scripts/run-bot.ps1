$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:OLLAMA_MODELS = Join-Path $ProjectRoot "runtime\ollama\models"
$NodeModules = Join-Path $ProjectRoot "node_modules"

& (Join-Path $PSScriptRoot "check-storage.ps1")

if (-not (Test-Path (Join-Path $ProjectRoot ".env"))) {
    throw "Missing .env. Copy .env.example to .env and fill DISCORD_TOKEN before running the bot."
}

if (-not (Test-Path $NodeModules)) {
    throw "Missing node_modules. Run scripts\install-deps.ps1 first."
}

$ProjectNode = Join-Path $ProjectRoot "runtime\node\node.exe"
$AllowPathRuntime = $env:TINYDCBOT_ALLOW_PATH_RUNTIME -eq "true"
$Node = $null

if (Test-Path $ProjectNode) {
    $Node = [PSCustomObject]@{ Source = $ProjectNode }
}
elseif ($AllowPathRuntime) {
    $Node = Get-Command node -ErrorAction SilentlyContinue
}

if (-not $Node) {
    throw "node was not found at D:\TinyDcBot\runtime\node\node.exe. Project-local Node is required unless TINYDCBOT_ALLOW_PATH_RUNTIME=true is set intentionally."
}

& (Join-Path $PSScriptRoot "runtime-guard.ps1") -Action start-bot -FailOnRisk
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

Push-Location $ProjectRoot
try {
    & $Node.Source (Join-Path $ProjectRoot "src\index.js")
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
