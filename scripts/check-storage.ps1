$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$RequiredRoot = "D:\TinyDcBot"

if ($ProjectRoot -ne $RequiredRoot) {
    throw "Project root must be $RequiredRoot, got $ProjectRoot"
}

$RequiredDirs = @(
    "runtime\node",
    "runtime\ollama\bin",
    "runtime\ollama\models",
    "runtime\ollama\logs",
    "runtime\bot\logs",
    "runtime\bot\cache",
    "runtime\npm-cache"
)

foreach ($Dir in $RequiredDirs) {
    $Path = Join-Path $ProjectRoot $Dir
    if (-not (Test-Path $Path)) {
        New-Item -ItemType Directory -Force -Path $Path | Out-Null
    }
}

$ExpectedModels = Join-Path $ProjectRoot "runtime\ollama\models"
if ($env:OLLAMA_MODELS -and ((Resolve-Path -LiteralPath $env:OLLAMA_MODELS -ErrorAction SilentlyContinue).Path -ne $ExpectedModels)) {
    throw "OLLAMA_MODELS points outside the project: $env:OLLAMA_MODELS"
}

Write-Host "Project root: $ProjectRoot"
Write-Host "Required Ollama model path: $ExpectedModels"
Write-Host "Storage check passed."
