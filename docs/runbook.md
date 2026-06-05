# Runbook

## Start Dashboard

Double-click:

```text
D:\TinyDcBot\Start-Dashboard.cmd
```

The dashboard opens at:

```text
http://127.0.0.1:8787
```

Use it to start/stop Ollama, pull/test `qwen3.5:4b`, start/stop the Discord bot, read logs, and chat with Qwen directly.

## Start Ollama

Start Ollama through the project script:

```powershell
scripts\start-ollama.ps1
```

The script sets:

```text
D:\TinyDcBot\runtime\ollama\models
```

Confirm the API responds from another PowerShell:

```powershell
Invoke-RestMethod http://localhost:11434/api/tags
```

## Start Bot

From `D:\TinyDcBot`:

```powershell
scripts\doctor.ps1
npm config get cache
scripts\run-bot.ps1
```

Expected npm cache:

```text
D:\TinyDcBot\runtime\npm-cache
```

## Common Problems

### Bot is offline

Check:

- `DISCORD_TOKEN` is set.
- If `.env` is missing, run `scripts\init-env.ps1`.
- The token was copied correctly.
- The bot was invited to the server.
- The Node process is still running.

### Bot sees messages but does not reply

Check:

- The channel/user allowlist.
- Whether the bot requires a mention.
- Discord message content intent.

### Bot says Ollama is offline

Check:

```powershell
ollama list
Invoke-RestMethod http://localhost:11434/api/tags
```

If the model is missing:

```powershell
scripts\pull-model.ps1
```

After pulling, confirm model files landed under:

```text
D:\TinyDcBot\runtime\ollama\models
```

### Replies are too slow

Try:

- Smaller model.
- Shorter system prompt.
- No conversation memory.
- Lower context size later if exposed in options.

## MVP Done Checklist

- Bot replies in one private Discord test server.
- Bot does not reply to other bots.
- Bot can handle Ollama being offline.
- Token and local config are not committed.
- README documents the local-only model boundary.
- Ollama model files are verified under `D:\TinyDcBot\runtime\ollama\models`.
