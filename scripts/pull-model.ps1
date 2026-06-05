$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:OLLAMA_MODELS = Join-Path $ProjectRoot "runtime\ollama\models"
. (Join-Path $PSScriptRoot "load-env.ps1")
$Model = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { "qwen3.5:4b" }

& (Join-Path $PSScriptRoot "check-storage.ps1")

$ProjectOllama = Join-Path $ProjectRoot "runtime\ollama\bin\ollama.exe"
$AllowPathRuntime = $env:TINYDCBOT_ALLOW_PATH_RUNTIME -eq "true"
$Ollama = $null

if (Test-Path $ProjectOllama) {
    $Ollama = $ProjectOllama
}
elseif ($AllowPathRuntime) {
    $PathOllama = Get-Command ollama -ErrorAction SilentlyContinue
    if ($PathOllama) {
        $Ollama = $PathOllama.Source
    }
}

if (-not $Ollama) {
    throw "Could not find ollama.exe at D:\TinyDcBot\runtime\ollama\bin\ollama.exe. Project-local Ollama is required unless TINYDCBOT_ALLOW_PATH_RUNTIME=true is set intentionally."
}

Write-Host "OLLAMA_MODELS=$env:OLLAMA_MODELS"
Write-Host "Pulling model: $Model"
& $Ollama pull $Model
exit $LASTEXITCODE
