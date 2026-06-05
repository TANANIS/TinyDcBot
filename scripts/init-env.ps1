$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvPath = Join-Path $ProjectRoot ".env"
$ExamplePath = Join-Path $ProjectRoot ".env.example"

& (Join-Path $PSScriptRoot "check-storage.ps1")

if (-not (Test-Path $ExamplePath)) {
    throw "Missing .env.example."
}

if (Test-Path $EnvPath) {
    $Overwrite = Read-Host ".env already exists. Overwrite? Type YES to continue"
    if ($Overwrite -ne "YES") {
        Write-Host "Cancelled. Existing .env was not changed."
        exit 0
    }
}

$SecureToken = Read-Host "Paste Discord bot token" -AsSecureString
$ClientId = Read-Host "Discord client/application ID (optional)"
$GuildId = Read-Host "Discord test guild/server ID (optional)"
$AllowedUserIds = Read-Host "Allowed user IDs, comma-separated (optional)"
$AllowedChannelIds = Read-Host "Allowed channel IDs, comma-separated (optional)"

$TokenPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureToken)
try {
    $PlainToken = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($TokenPtr)
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($TokenPtr)
}

if ([string]::IsNullOrWhiteSpace($PlainToken)) {
    throw "Discord token cannot be empty."
}

$Lines = @(
    "DISCORD_TOKEN=$PlainToken",
    "DISCORD_CLIENT_ID=$ClientId",
    "DISCORD_GUILD_ID=$GuildId",
    "OLLAMA_BASE_URL=http://127.0.0.1:11434",
    "OLLAMA_MODEL=qwen3.5:4b",
    "OLLAMA_MODELS=D:\TinyDcBot\runtime\ollama\models",
    "BOT_ALLOWED_USER_IDS=$AllowedUserIds",
    "BOT_ALLOWED_CHANNEL_IDS=$AllowedChannelIds",
    "BOT_REQUIRE_MENTION=true",
    "BOT_MAX_INPUT_CHARS=1800",
    "BOT_MAX_REPLY_CHARS=1800",
    "BOT_REQUEST_TIMEOUT_MS=90000",
    "BOT_COOLDOWN_MS=3000"
)

Set-Content -LiteralPath $EnvPath -Value $Lines -Encoding UTF8
Write-Host ".env created at $EnvPath"
Write-Host "Token was written to .env and was not printed."
