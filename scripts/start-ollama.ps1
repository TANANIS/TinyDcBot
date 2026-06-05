$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:OLLAMA_MODELS = Join-Path $ProjectRoot "runtime\ollama\models"
$AllowPathRuntime = $env:TINYDCBOT_ALLOW_PATH_RUNTIME -eq "true"

& (Join-Path $PSScriptRoot "check-storage.ps1")

$ProjectOllama = Join-Path $ProjectRoot "runtime\ollama\bin\ollama.exe"

if (Test-Path $ProjectOllama) {
    Write-Host "Starting project-local Ollama: $ProjectOllama"
    & $ProjectOllama serve
    exit $LASTEXITCODE
}

if ($AllowPathRuntime) {
    $PathOllama = Get-Command ollama -ErrorAction SilentlyContinue
}

if ($AllowPathRuntime -and $PathOllama) {
    Write-Host "Starting PATH Ollama with project-local OLLAMA_MODELS."
    & $PathOllama.Source serve
    exit $LASTEXITCODE
}

throw "Could not find ollama.exe at D:\TinyDcBot\runtime\ollama\bin\ollama.exe. Project-local Ollama is required unless TINYDCBOT_ALLOW_PATH_RUNTIME=true is set intentionally."
