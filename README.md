# TinyDcBot

TinyDcBot is a small self-hosted Discord assistant that replies through a local Ollama model instead of calling the OpenAI API.

Start it from:

```text
D:\TinyDcBot\Start-Dashboard.cmd
```

Stop all TinyDcBot services from:

```text
D:\TinyDcBot\Stop-All.cmd
```

`Stop-All.cmd` stops only project-matched TinyDcBot processes: the dashboard Node process, the Discord bot Node process, and the project-local Ollama process under `D:\TinyDcBot\runtime\ollama`.

The dashboard opens at `http://127.0.0.1:8787` and can control Ollama, the Discord bot, logs, memory, and a direct Qwen chat panel.

The first goal is intentionally small:

- Receive Discord messages from an allowlisted server or user.
- Send prompts to a local Ollama model.
- Return short, useful replies in Discord.
- Provide a local HTML dashboard with status, controls, logs, and direct Qwen chat.
- Keep all secrets out of source control.
- Make the service easy to run on a local Windows machine first.
- Keep project runtime data inside `D:\TinyDcBot`.

## Why Ollama

This project is for a private, lightweight assistant where API cost and API key management are not desired. Ollama lets the bot call a local model through an HTTP endpoint, usually `http://localhost:11434`.

Tradeoffs:

- No OpenAI API key is required.
- Replies depend on the local model quality.
- The machine running Ollama must have enough RAM/VRAM.
- Tool use and long-context coding ability will be much more limited than Codex or ChatGPT.

## Hard Storage Rule

All project-owned runtime files must stay under `D:\TinyDcBot`.

This includes:

- Discord bot source and config templates.
- Local logs.
- Ollama model files.
- Downloaded runtime binaries used specifically by this project.
- Any future cache, memory, vector store, database, transcript, or debug dump.

The project must not intentionally create runtime data in:

- `C:\Users\<user>\.ollama`
- `C:\Users\<user>\AppData`
- `C:\ProgramData`
- Any directory outside `D:\TinyDcBot`

Because normal Windows applications may create their own installer metadata or service files outside the project, the preferred implementation path is a project-local runtime layout and a verification checklist before first model pull. See [docs/storage-policy.md](docs/storage-policy.md).

By default, project scripts require runtime binaries inside:

```text
D:\TinyDcBot\runtime\node\node.exe
D:\TinyDcBot\runtime\node\npm.cmd
D:\TinyDcBot\runtime\ollama\bin\ollama.exe
```

Using PATH runtimes is disabled unless `TINYDCBOT_ALLOW_PATH_RUNTIME=true` is set intentionally.

## MVP Architecture

```text
Discord
   |
   | Discord Bot Token
   v
TinyDcBot service
   |
   | HTTP local call
   v
Ollama
   |
   v
Small local model
```

The Discord bot token is still required because Discord needs to authenticate the bot. The important boundary is that no OpenAI API key is needed.

## Recommended Stack

Initial implementation:

- Runtime: Node.js LTS
- Discord library: `discord.js`
- Local model backend: Ollama
- Config: `.env`
- Process runner: PowerShell during development, later optional Windows Task Scheduler or NSSM
- Runtime storage root: `D:\TinyDcBot\runtime`
- Runtime binary root: `D:\TinyDcBot\runtime`

Good starter models:

- `qwen3.5:4b`
- `llama3.2:3b`
- `qwen3:1.7b`

For this machine, start with `qwen3.5:4b`. See [docs/model-recommendation.md](docs/model-recommendation.md).

## Environment Variables

Create a local `.env` file later with:

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_GUILD_ID=optional_test_server_id
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.5:4b
OLLAMA_MODELS=D:\TinyDcBot\runtime\ollama\models
BOT_ALLOWED_USER_IDS=
BOT_ALLOWED_CHANNEL_IDS=
```

Never commit `.env`.

## Security Rules

- Keep `DISCORD_TOKEN` only on the machine running the bot.
- Use `scripts\init-env.ps1` to write the token locally without putting it in command history.
- Do not log full Discord tokens or private prompts.
- Start with allowlisted channels or users.
- Keep the bot private while testing.
- Avoid giving the model shell, filesystem, browser, or admin capabilities in the MVP.
- Treat Ollama responses as untrusted text.
- Keep all bot-created files and Ollama model files inside `D:\TinyDcBot`.

## MVP Behavior

The bot should:

- Ignore messages from other bots.
- Reply only when mentioned, or only inside allowlisted channels.
- Show a short typing indicator while generating.
- Use a timeout when calling Ollama.
- Return a friendly error if Ollama is offline.
- Limit message length before sending to Discord.

Suggested reply style:

- Default language follows the user.
- Keep answers concise.
- Ask one clarifying question only when needed.
- Avoid pretending to have access to Codex, local files, or private state.

## Development Phases

### Phase 1: Documentation and Shape

- Create project docs.
- Decide runtime and model.
- Define config and security boundary.

### Phase 2: Minimal Bot

- Initialize Node project.
- Add `discord.js`, `dotenv`, and a simple Ollama client.
- Reply to mentions in one test server.
- Use project scripts for storage checks, dependency install, Ollama startup, model pull, and bot launch.

### Phase 3: Reliability

- Add request timeout.
- Add per-user cooldown.
- Add max prompt size.
- Add structured logging.

### Phase 4: Better Chat

- Add short conversation memory per channel.
- Add system prompt configuration.
- Add model switch through config.

### Phase 5: Deployment

- Run as a Windows background process.
- Add restart behavior.
- Add health check notes.

## Local Ollama Commands

Install and run Ollama separately, then pull a model:

```powershell
scripts\pull-model.ps1
scripts\test-ollama.ps1
```

Quick API test:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://localhost:11434/api/chat `
  -ContentType 'application/json' `
  -Body '{"model":"qwen3.5:4b","messages":[{"role":"user","content":"用繁體中文簡短自我介紹"}],"stream":false}'
```

## Repository Scope
This repository contains the Discord bot source, the local dashboard UI, setup and operations scripts, project-local runtime policy docs, and safe example configuration.

It intentionally excludes local secrets, installed dependencies, downloaded runtime binaries, Ollama models, model manifests, caches, logs, Discord conversation traces, and any other machine-local runtime data.

## Files To Add Next

Planned project shape:

```text
D:\TinyDcBot
  README.md
  docs\
    design.md
    model-recommendation.md
    setup.md
    runbook.md
    storage-policy.md
  runtime\
    node\
    ollama\
      bin\
      models\
      logs\
  src\
    index.js
    ollamaClient.js
    config.js
  scripts\
    check-storage.ps1
    doctor.ps1
    install-deps.ps1
    pull-model.ps1
    run-bot.ps1
    start-ollama.ps1
    test-ollama.ps1
  .env.example
  .gitignore
  package.json
```
