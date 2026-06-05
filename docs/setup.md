# Setup Notes

## Requirements

- Windows 10 or 11
- Project-local Node.js runtime under `D:\TinyDcBot\runtime\node`
- Project-local Ollama runtime under `D:\TinyDcBot\runtime\ollama\bin`
- A Discord application and bot token
- One private Discord test server
- Enough free disk space under `D:\TinyDcBot` for model files

## Storage Requirement

All project-owned runtime files must stay inside:

```text
D:\TinyDcBot
```

Read [storage-policy.md](storage-policy.md) before installing or pulling any model.

## 1. Install Ollama

Place standalone Ollama at:

```text
D:\TinyDcBot\runtime\ollama\bin\ollama.exe
```

Do not pull a model until the model directory is set to:

```text
D:\TinyDcBot\runtime\ollama\models
```

Create the model directory:

```powershell
New-Item -ItemType Directory -Force -Path "D:\TinyDcBot\runtime\ollama\models"
```

Set the model path in the shell that will start Ollama:

```powershell
$env:OLLAMA_MODELS = "D:\TinyDcBot\runtime\ollama\models"
```

Then confirm Ollama works:

```powershell
D:\TinyDcBot\runtime\ollama\bin\ollama.exe --version
```

Pull the recommended small model:

```powershell
scripts\pull-model.ps1
```

Run a quick manual test:

```powershell
scripts\test-ollama.ps1
```

## 2. Create Discord Bot

In the Discord Developer Portal:

1. Create an application.
2. Add a bot.
3. Copy the bot token.
4. Enable the message content intent if the bot needs to read normal messages.
5. Invite the bot to your private test server.

For safer MVP behavior, make the bot respond only to mentions or only in one test channel.

## 3. Project Config

Create `.env` with the local initializer:

```powershell
scripts\init-env.ps1
```

Paste the Discord token only into the secure prompt. Do not paste it into command history, docs, or chat logs.

Expected values:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_MODELS=D:\TinyDcBot\runtime\ollama\models
BOT_ALLOWED_USER_IDS=
BOT_ALLOWED_CHANNEL_IDS=
```

## 4. First Run

Before installing dependencies, run:

```powershell
scripts\doctor.ps1
```

Install dependencies:

```powershell
npm config get cache
scripts\install-deps.ps1
```

Expected npm cache:

```text
D:\TinyDcBot\runtime\npm-cache
```

The bot should appear online in Discord and reply in the configured test channel.

Start Ollama in one PowerShell:

```powershell
scripts\start-ollama.ps1
```

Pull the target model in another PowerShell:

```powershell
scripts\pull-model.ps1
```

Test the model:

```powershell
scripts\test-ollama.ps1
```

Run the bot:

```powershell
scripts\run-bot.ps1
```
