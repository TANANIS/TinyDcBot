param(
    [switch] $DryRun
)

$ErrorActionPreference = "Stop"

$ProjectRoot = "D:\TinyDcBot"
$DashboardUrl = "http://127.0.0.1:8787"
$Stopped = New-Object System.Collections.Generic.List[string]
$Skipped = New-Object System.Collections.Generic.List[string]

function Stop-ProjectProcess {
    param(
        [Parameter(Mandatory = $true)] [string] $Name,
        [Parameter(Mandatory = $true)] [scriptblock] $Match
    )

    $processes = Get-CimInstance Win32_Process | Where-Object { & $Match $_ }

    foreach ($process in $processes) {
        try {
            if ($DryRun) {
                $Stopped.Add("would stop $Name pid=$($process.ProcessId)") | Out-Null
            }
            else {
                Stop-Process -Id $process.ProcessId -Force -ErrorAction Stop
                $Stopped.Add("$Name pid=$($process.ProcessId)") | Out-Null
            }
        }
        catch {
            $Skipped.Add("$Name pid=$($process.ProcessId): $($_.Exception.Message)") | Out-Null
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

Stop-ProjectProcess -Name "TinyDcBot Node" -Match {
    param($Process)
    $Process.Name -ieq "node.exe" -and $Process.CommandLine -like "*D:\TinyDcBot*"
}

Stop-ProjectProcess -Name "TinyDcBot Ollama" -Match {
    param($Process)
    ($Process.Name -ieq "ollama.exe") -and (
        $Process.ExecutablePath -like "D:\TinyDcBot\runtime\ollama\*" -or
        $Process.CommandLine -like "*D:\TinyDcBot\runtime\ollama*" -or
        $Process.CommandLine -like "*D:\TinyDcBot\runtime\ollama\models*"
    )
}

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