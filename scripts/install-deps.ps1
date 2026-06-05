$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$NpmCache = Join-Path $ProjectRoot "runtime\npm-cache"

& (Join-Path $PSScriptRoot "check-storage.ps1")

$ProjectNpm = Join-Path $ProjectRoot "runtime\node\npm.cmd"
$AllowPathRuntime = $env:TINYDCBOT_ALLOW_PATH_RUNTIME -eq "true"
$Npm = $null

if (Test-Path $ProjectNpm) {
    $Npm = [PSCustomObject]@{ Source = $ProjectNpm }
}
elseif ($AllowPathRuntime) {
    $Npm = Get-Command npm -ErrorAction SilentlyContinue
}

if (-not $Npm) {
    throw "npm was not found at D:\TinyDcBot\runtime\node\npm.cmd. Project-local Node is required unless TINYDCBOT_ALLOW_PATH_RUNTIME=true is set intentionally."
}

Push-Location $ProjectRoot
try {
    Write-Host "npm cache: $NpmCache"
    & $Npm.Source config set cache $NpmCache --location project
    & $Npm.Source install --cache $NpmCache
}
finally {
    Pop-Location
}
