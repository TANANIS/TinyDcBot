$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$env:OLLAMA_MODELS = Join-Path $ProjectRoot "runtime\ollama\models"
. (Join-Path $PSScriptRoot "load-env.ps1")
$Model = if ($env:OLLAMA_MODEL) { $env:OLLAMA_MODEL } else { "qwen3.5:4b" }
$BaseUrl = if ($env:OLLAMA_BASE_URL) { $env:OLLAMA_BASE_URL.TrimEnd("/") } else { "http://127.0.0.1:11434" }
$NumCtx = if ($env:OLLAMA_NUM_CTX) { [int]$env:OLLAMA_NUM_CTX } else { 4096 }
$Temperature = if ($env:OLLAMA_TEMPERATURE) { [double]$env:OLLAMA_TEMPERATURE } else { 0.9 }
$TopP = if ($env:OLLAMA_TOP_P) { [double]$env:OLLAMA_TOP_P } else { 0.9 }
$RepeatPenalty = if ($env:OLLAMA_REPEAT_PENALTY) { [double]$env:OLLAMA_REPEAT_PENALTY } else { 1.08 }

& (Join-Path $PSScriptRoot "check-storage.ps1")
& (Join-Path $PSScriptRoot "runtime-guard.ps1") -Action test-model -FailOnRisk
if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
}

$Body = @{
    model = $Model
    stream = $false
    think = $false
    options = @{
        num_predict = 64
        num_ctx = $NumCtx
        temperature = $Temperature
        top_p = $TopP
        repeat_penalty = $RepeatPenalty
    }
    messages = @(
        @{
            role = "user"
            content = "Say hello in one short Traditional Chinese sentence."
        }
    )
} | ConvertTo-Json -Depth 8

Write-Host "Testing Ollama model: $Model"
Write-Host "Options: num_ctx=$NumCtx temperature=$Temperature top_p=$TopP repeat_penalty=$RepeatPenalty"
$Result = Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/chat" -ContentType "application/json" -Body $Body
$Content = $Result.message.content
Write-Host "Response: $Content"
