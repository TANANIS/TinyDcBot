param(
    [int]$Last = 20
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$LogPath = Join-Path $ProjectRoot "runtime\bot\ollama-performance.jsonl"

if (-not (Test-Path -LiteralPath $LogPath)) {
    Write-Host "No performance log yet: $LogPath"
    return
}

$Rows = Get-Content -LiteralPath $LogPath |
    Where-Object { $_.Trim() } |
    Select-Object -Last $Last |
    ForEach-Object { $_ | ConvertFrom-Json }

if (-not $Rows) {
    Write-Host "Performance log is empty: $LogPath"
    return
}

$Rows |
    Select-Object @{Name = "time"; Expression = { ([datetime]$_.ts).ToString("HH:mm:ss") } },
        model,
        @{Name = "ctx"; Expression = { $_.options.num_ctx } },
        @{Name = "pred"; Expression = { $_.options.num_predict } },
        @{Name = "sec"; Expression = { $_.wallSeconds } },
        @{Name = "tok_s"; Expression = { $_.outputTokensPerSecond } },
        @{Name = "out"; Expression = { $_.evalCount } },
        @{Name = "vram0"; Expression = { $_.vramFreeBeforeMb } },
        @{Name = "vram1"; Expression = { $_.vramFreeAfterMb } },
        @{Name = "reason"; Expression = { $_.doneReason } },
        error |
    Format-Table -AutoSize

Write-Host ""
Write-Host "Log path: $LogPath"
