param(
    [string]$Path = (Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..")).Path ".env")
)

if (-not (Test-Path -LiteralPath $Path)) {
    return
}

Get-Content -LiteralPath $Path | ForEach-Object {
    $Line = $_.Trim()
    if (-not $Line -or $Line.StartsWith("#")) {
        return
    }

    $Index = $Line.IndexOf("=")
    if ($Index -le 0) {
        return
    }

    $Name = $Line.Substring(0, $Index).Trim().Trim([char]0xFEFF)
    $Value = $Line.Substring($Index + 1).Trim()

    if (($Value.StartsWith('"') -and $Value.EndsWith('"')) -or ($Value.StartsWith("'") -and $Value.EndsWith("'"))) {
        $Value = $Value.Substring(1, $Value.Length - 2)
    }

    if ($Name -and -not [Environment]::GetEnvironmentVariable($Name, "Process")) {
        [Environment]::SetEnvironmentVariable($Name, $Value, "Process")
    }
}
