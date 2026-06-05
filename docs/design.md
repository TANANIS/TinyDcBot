# TinyDcBot Design

## Goal

Build a private Discord bot that answers through a local Ollama model. The service should be small, understandable, and safe to run on a personal Windows machine.

## Non-Goals

- No OpenAI API integration.
- No autonomous computer control.
- No unrestricted file access.
- No multi-server public bot launch in the first version.
- No database requirement for the MVP.
- No runtime data outside `D:\TinyDcBot`.

## Message Flow

1. Discord sends a message event to the bot process.
2. The bot filters out bot messages and non-allowed channels/users.
3. If the message qualifies, the bot extracts clean user text.
4. The bot sends a chat request to Ollama.
5. The bot trims the response to Discord-safe length.
6. The bot replies in the same channel.

## Access Control

Use environment variables for allowlists:

- `BOT_ALLOWED_USER_IDS`
- `BOT_ALLOWED_CHANNEL_IDS`

If an allowlist is empty, the first implementation should be conservative. Prefer requiring either a mention or a specific test channel.

## Ollama Request Shape

Use `/api/chat` with `stream: false` for the MVP.

Example body:

```json
{
  "model": "qwen3.5:4b",
  "messages": [
    {
      "role": "system",
      "content": "You are a concise private Discord assistant. Reply in the user's language."
    },
    {
      "role": "user",
      "content": "你好"
    }
  ],
  "stream": false
}
```

## Failure Handling

Expected failures:

- Ollama is not running.
- The selected model is not pulled.
- The model takes too long.
- Discord message is too long.
- Discord token is invalid.

The bot should fail gently in Discord with a short message such as:

```text
我現在連不到本機模型，先確認 Ollama 有沒有開著。
```

## Conversation Memory

MVP should start stateless.

Later, add a small in-memory rolling window:

- Per channel or per user.
- Keep last 4 to 8 turns.
- Drop history on process restart.
- Never store private messages on disk unless explicitly enabled.

## Safety Boundary

The model can only produce text. It should not execute commands or read files. Any future tool capability should be added one tool at a time with explicit allowlists and logs.

## Storage Boundary

All bot-owned runtime data must remain inside `D:\TinyDcBot`. Ollama must use `D:\TinyDcBot\runtime\ollama\models` for model storage. If Ollama cannot be proven to respect this boundary on the target machine, the architecture should switch to a project-local GGUF runner while keeping the Discord message flow unchanged.
