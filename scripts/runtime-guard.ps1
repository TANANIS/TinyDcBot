param(
    [ValidateSet("status", "start-ollama", "pull-model", "start-bot", "test-model", "chat", "autonomy-preview")]
    [string] $Action = "status",
    [switch] $FailOnRisk,
    [switch] $CleanOrphans,
    [switch] $Json,
    [int] $MinFreeVramMb = 0
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "load-env.ps1")
$OllamaRoot = Join-Path $ProjectRoot "runtime\ollama"
$NodeRoot = Join-Path $ProjectRoot "runtime\node"
if ($MinFreeVramMb -le 0) {
    $MinFreeVramMb = if ($env:OLLAMA_MIN_FREE_VRAM_MB) { [int] $env:OLLAMA_MIN_FREE_VRAM_MB } else { 1800 }
}

function Test-InsidePath {
    param(
        [string] $Value,
        [string] $Root
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        return $false
    }

    try {
        $Resolved = [System.IO.Path]::GetFullPath($Value)
        $ResolvedRoot = [System.IO.Path]::GetFullPath($Root).TrimEnd("\")
        return $Resolved.Equals($ResolvedRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
            $Resolved.StartsWith("$ResolvedRoot\", [System.StringComparison]::OrdinalIgnoreCase)
    }
    catch {
        return $false
    }
}

function Get-RelevantProcesses {
    $Items = New-Object System.Collections.Generic.List[object]
    foreach ($Process in Get-Process -Name "ollama", "llama-server", "node" -ErrorAction SilentlyContinue) {
        $Path = $null
        $StartTime = $null
        $CpuSeconds = $null
        try { $Path = $Process.Path } catch {}
        try { $StartTime = $Process.StartTime.ToString("o") } catch {}
        try { $CpuSeconds = [Math]::Round($Process.CPU, 2) } catch {}
        $Name = "$($Process.ProcessName).exe".ToLowerInvariant()
        $Items.Add([PSCustomObject]@{
            pid = $Process.Id
            name = $Name
            path = $Path
            startTime = $StartTime
            workingSetMb = [Math]::Round($Process.WorkingSet64 / 1MB, 1)
            cpuSeconds = $CpuSeconds
            projectOllama = (Test-InsidePath $Path $OllamaRoot)
            projectNode = (Test-InsidePath $Path $NodeRoot)
            projectLocal = (Test-InsidePath $Path $ProjectRoot)
        }) | Out-Null
    }
    return @($Items.ToArray())
}

function Get-GpuSnapshot {
    try {
        $Rows = & nvidia-smi --query-gpu=memory.total,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits 2>$null
        $Parsed = @()
        foreach ($Row in $Rows) {
            if ([string]::IsNullOrWhiteSpace($Row)) { continue }
            $Parts = $Row.Split(",") | ForEach-Object { [int] $_.Trim() }
            if ($Parts.Count -ge 4) {
                $Parsed += [PSCustomObject]@{
                    totalMb = $Parts[0]
                    usedMb = $Parts[1]
                    freeMb = $Parts[2]
                    utilizationPct = $Parts[3]
                }
            }
        }
        if ($Parsed.Count -eq 0) {
            return [PSCustomObject]@{ available = $false; error = "nvidia-smi returned no rows" }
        }
        $Best = $Parsed | Sort-Object freeMb -Descending | Select-Object -First 1
        return [PSCustomObject]@{
            available = $true
            totalMb = $Best.totalMb
            usedMb = $Best.usedMb
            freeMb = $Best.freeMb
            utilizationPct = $Best.utilizationPct
            gpus = $Parsed
        }
    }
    catch {
        return [PSCustomObject]@{ available = $false; error = $_.Exception.Message }
    }
}

function Get-OllamaPsSnapshot {
    try {
        $Data = Invoke-RestMethod -Method Get -Uri "http://127.0.0.1:11434/api/ps" -TimeoutSec 2
        $Models = if ($Data.models) { @($Data.models) } else { @() }
        return [PSCustomObject]@{ responds = $true; models = $Models }
    }
    catch {
        return [PSCustomObject]@{ responds = $false; error = $_.Exception.Message; models = @() }
    }
}

function New-Risk {
    param(
        [string] $Code,
        [string] $Severity,
        [bool] $Blocking,
        [string] $Message
    )
    return [PSCustomObject]@{ code = $Code; severity = $Severity; blocking = $Blocking; message = $Message }
}

$Processes = Get-RelevantProcesses
$ProjectOllama = @($Processes | Where-Object { $_.name -eq "ollama.exe" -and $_.projectOllama })
$ProjectLlama = @($Processes | Where-Object { $_.name -eq "llama-server.exe" -and $_.projectOllama })
$ProjectNode = @($Processes | Where-Object { $_.name -eq "node.exe" -and $_.projectNode })
$Gpu = Get-GpuSnapshot
$OllamaPs = Get-OllamaPsSnapshot

$ModelUseActions = @("start-bot", "test-model", "chat", "autonomy-preview")
$OllamaStartActions = @("start-ollama", "pull-model")
$Risks = New-Object System.Collections.Generic.List[object]

if ($ProjectOllama.Count -gt 1) {
    $Risks.Add((New-Risk "DUPLICATE_OLLAMA_SERVER" "warn" ($ModelUseActions.Contains($Action) -or $OllamaStartActions.Contains($Action)) "Found $($ProjectOllama.Count) project-local ollama.exe processes.")) | Out-Null
}
if ($ProjectLlama.Count -gt 1) {
    $Risks.Add((New-Risk "DUPLICATE_LLAMA_SERVER" "danger" ($ModelUseActions.Contains($Action) -or $OllamaStartActions.Contains($Action)) "Found $($ProjectLlama.Count) project-local llama-server.exe processes.")) | Out-Null
}
if ($ProjectLlama.Count -gt 0 -and ((-not $OllamaPs.responds) -or @($OllamaPs.models).Count -eq 0)) {
    $Risks.Add((New-Risk "ORPHAN_LLAMA_SERVER" "danger" ($ModelUseActions.Contains($Action) -or $OllamaStartActions.Contains($Action)) "Project-local llama-server.exe exists, but Ollama reports no loaded model.")) | Out-Null
}
if ($Gpu.available -and $Gpu.freeMb -lt $MinFreeVramMb) {
    $Risks.Add((New-Risk "LOW_FREE_VRAM" "warn" ($ModelUseActions.Contains($Action)) "Free VRAM $($Gpu.freeMb) MB is below OLLAMA_MIN_FREE_VRAM_MB=$MinFreeVramMb.")) | Out-Null
}

$Killed = @()
$Skipped = @()
if ($CleanOrphans) {
    $Cleanable = @($Risks.ToArray() | Where-Object { $_.code -eq "ORPHAN_LLAMA_SERVER" -or $_.code -eq "DUPLICATE_LLAMA_SERVER" })
    foreach ($Process in $(if ($Cleanable.Count -gt 0) { $ProjectLlama } else { @() })) {
        try {
            Stop-Process -Id $Process.pid -Force -ErrorAction Stop
            $Killed += [PSCustomObject]@{ pid = $Process.pid; name = $Process.name; path = $Process.path }
        }
        catch {
            $Skipped += [PSCustomObject]@{ pid = $Process.pid; name = $Process.name; path = $Process.path; error = $_.Exception.Message }
        }
    }
}

$RiskArray = @($Risks.ToArray())
$BlockingRisks = @($RiskArray | Where-Object { $_.blocking })
$Snapshot = [PSCustomObject]@{
    ok = $true
    action = $Action
    projectRoot = $ProjectRoot
    minFreeVramMb = $MinFreeVramMb
    gpu = $Gpu
    ollama = $OllamaPs
    processes = [PSCustomObject]@{
        projectOllama = $ProjectOllama
        projectLlamaServers = $ProjectLlama
        projectNode = $ProjectNode
    }
    risks = $RiskArray
    blockingRisks = @($BlockingRisks)
    safe = ($BlockingRisks.Count -eq 0)
    cleaned = [PSCustomObject]@{ killed = $Killed; skipped = $Skipped }
}

if ($Json) {
    $Snapshot | ConvertTo-Json -Depth 8
}
else {
    Write-Host "TinyDcBot runtime guard"
    Write-Host "Action: $Action"
    if ($Gpu.available) {
        Write-Host "GPU: free=$($Gpu.freeMb) MB used=$($Gpu.usedMb) MB util=$($Gpu.utilizationPct)% min=$MinFreeVramMb MB"
    }
    else {
        Write-Host "GPU: unavailable ($($Gpu.error))"
    }
    Write-Host "Ollama /api/ps: responds=$($OllamaPs.responds) loadedModels=$(@($OllamaPs.models).Count)"
    Write-Host "Project ollama.exe: $($ProjectOllama.Count)"
    Write-Host "Project llama-server.exe: $($ProjectLlama.Count)"
    Write-Host "Project node.exe: $($ProjectNode.Count)"
    if ($Risks.Count -eq 0) {
        Write-Host "Risks: none"
    }
    else {
        Write-Host "Risks:"
        foreach ($Risk in $Risks) {
            Write-Host "- $($Risk.code) blocking=$($Risk.blocking): $($Risk.message)"
        }
    }
    if ($CleanOrphans) {
        Write-Host "Cleaned llama-server.exe: killed=$($Killed.Count) skipped=$($Skipped.Count)"
    }
}

if ($FailOnRisk -and $BlockingRisks.Count -gt 0) {
    exit 2
}

exit 0
