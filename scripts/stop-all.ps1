param(
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\TinyDcBot"
$DashboardUrl = "http://127.0.0.1:8787"
$OllamaRoot = Join-Path $ProjectRoot "runtime\ollama"
$NodeRoot = Join-Path $ProjectRoot "runtime\node"
$Stopped = New-Object System.Collections.Generic.List[string]
$Skipped = New-Object System.Collections.Generic.List[string]

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

function Stop-ProjectProcess {
    param(
        [Parameter(Mandatory = $true)] [string] $Label,
        [Parameter(Mandatory = $true)] [string[]] $ProcessNames,
        [Parameter(Mandatory = $true)] [string] $Root
    )

    $processes = Get-Process -Name $ProcessNames -ErrorAction SilentlyContinue | Where-Object {
        $Path = $null
        try { $Path = $_.Path } catch {}
        Test-InsidePath $Path $Root
    }

    foreach ($process in $processes) {
        try {
            if ($DryRun) {
                $Stopped.Add("would stop $Label pid=$($process.Id)") | Out-Null
            }
            else {
                Stop-Process -Id $process.Id -Force -ErrorAction Stop
                $Stopped.Add("$Label pid=$($process.Id)") | Out-Null
            }
        }
        catch {
            $Skipped.Add("$Label pid=$($process.Id): $($_.Exception.Message)") | Out-Null
        }
    }
}

if ($DryRun) {
    Write-Host "Dry run: scanning TinyDcBot services..."
}
else {
    Write-Host "Stopping TinyDcBot services..."

    try {
        Invoke-RestMethod -Method Post -Uri "$DashboardUrl/api/stop-bot" -TimeoutSec 2 | Out-Null
        Write-Host "Requested bot stop through dashboard."
    }
    catch {
        Write-Host "Dashboard stop-bot request skipped: $($_.Exception.Message)"
    }

    try {
        Invoke-RestMethod -Method Post -Uri "$DashboardUrl/api/stop-ollama" -TimeoutSec 2 | Out-Null
        Write-Host "Requested Ollama stop through dashboard."
    }
    catch {
        Write-Host "Dashboard stop-ollama request skipped: $($_.Exception.Message)"
    }

    Start-Sleep -Milliseconds 500
}

Stop-ProjectProcess -Label "TinyDcBot Node" -ProcessNames @("node") -Root $NodeRoot
Stop-ProjectProcess -Label "TinyDcBot Ollama" -ProcessNames @("ollama", "llama-server") -Root $OllamaRoot

Write-Host ""
if ($Stopped.Count -eq 0) {
    Write-Host "No TinyDcBot processes were running."
}
else {
    if ($DryRun) {
        Write-Host "Would stop:"
    }
    else {
        Write-Host "Stopped:"
    }

    foreach ($item in $Stopped) {
        Write-Host "- $item"
    }
}

if ($Skipped.Count -gt 0) {
    Write-Host ""
    Write-Host "Skipped or failed:"
    foreach ($item in $Skipped) {
        Write-Host "- $item"
    }
}

Write-Host ""
if ($DryRun) {
    Write-Host "TinyDcBot stop-all dry run finished."
}
else {
    Write-Host "TinyDcBot stop-all finished."
}
