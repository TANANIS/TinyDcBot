$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:OLLAMA_MODELS = Join-Path $ProjectRoot "runtime\ollama\models"
. (Join-Path $PSScriptRoot "load-env.ps1")
$Model = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { "qwen3.5:4b" }

& (Join-Path $PSScriptRoot "check-storage.ps1")

$AllowPathRuntime = $env:TINYDCBOT_ALLOW_PATH_RUNTIME -eq "true"

function Find-ProjectOrPathCommand($ProjectPath, $CommandName, $AllowPath) {
    if (Test-Path $ProjectPath) {
        return $ProjectPath
    }

    if ($AllowPath) {
        $Command = Get-Command $CommandName -ErrorAction SilentlyContinue
        if ($Command) {
            return $Command.Source
        }
    }

    return $null
}

$Node = Find-ProjectOrPathCommand (Join-Path $ProjectRoot "runtime\node\node.exe") "node" $AllowPathRuntime
$Npm = Find-ProjectOrPathCommand (Join-Path $ProjectRoot "runtime\node\npm.cmd") "npm" $AllowPathRuntime
$Ollama = Find-ProjectOrPathCommand (Join-Path $ProjectRoot "runtime\ollama\bin\ollama.exe") "ollama" $AllowPathRuntime
$NpmCache = Join-Path $ProjectRoot "runtime\npm-cache"

Write-Host ""
Write-Host "TinyDcBot doctor"
Write-Host "----------------"
Write-Host "Project root: $ProjectRoot"
Write-Host "OLLAMA_MODELS: $env:OLLAMA_MODELS"
Write-Host "Target model: $Model"
Write-Host "Allow PATH runtime: $AllowPathRuntime"
Write-Host "Node: $(if ($Node) { $Node } else { 'missing' })"
Write-Host "npm: $(if ($Npm) { $Npm } else { 'missing' })"
Write-Host "Ollama: $(if ($Ollama) { $Ollama } else { 'missing' })"
Write-Host ".env: $(if (Test-Path (Join-Path $ProjectRoot '.env')) { 'present' } else { 'missing' })"
Write-Host "node_modules: $(if (Test-Path (Join-Path $ProjectRoot 'node_modules')) { 'present' } else { 'missing' })"
Write-Host "Expected npm cache: $NpmCache"

if ($Npm) {
    Push-Location $ProjectRoot
    try {
        $ActualCache = & $Npm config get cache
        Write-Host "Actual npm cache: $ActualCache"
    }
    finally {
        Pop-Location
    }
}

Write-Host ""
Write-Host "Next order:"
if (Test-Path (Join-Path $ProjectRoot ".env")) {
    Write-Host "1. .env is present."
}
else {
    Write-Host "1. Run scripts\init-env.ps1 and paste the Discord token locally."
}
Write-Host "2. Run scripts\install-deps.ps1 if node_modules is missing."
Write-Host "3. Start Ollama with scripts\start-ollama.ps1 in one PowerShell."
Write-Host "4. Pull the model with scripts\pull-model.ps1 in another PowerShell."
Write-Host "5. Test Ollama with scripts\test-ollama.ps1."
Write-Host "6. Run the bot with scripts\run-bot.ps1."
