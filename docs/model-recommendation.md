# Model Recommendation

## Detected Machine

Checked on 2026-06-03:

```text
CPU: 12th Gen Intel Core i5-12400F
RAM: 16 GB
GPU: NVIDIA GeForce RTX 3050
VRAM: 8 GB
D: drive free space: about 77 GB
```

## Constraint

The model must not interfere with light DungeonFit development work. Assume the user may have Godot, an IDE, browser tabs, Discord, and normal Windows background tasks open while the bot is running.

Because of that, the default model should leave comfortable RAM and VRAM headroom instead of trying to maximize answer quality.

## Recommended Default

Use:

```text
qwen3.5:4b
```

Why:

- Strong Chinese and English support.
- Newer 4B-class Qwen target than the earlier `qwen3:4b` baseline.
- Better reasoning and instruction following than very tiny 1B models.
- Small enough to fit comfortably on an RTX 3050 8GB setup.
- Less likely than 8B models to compete with Godot/editor/browser work.
- Good fit for Discord Q&A, short planning, translation, summaries, and lightweight coding discussion.

Recommended config:

```env
OLLAMA_MODEL=qwen3.5:4b
```

If this exact tag is not available in the selected Ollama runtime, stop and verify the intended source before substituting another model. The fallback should be an explicit decision, not an accidental downgrade.

## Conservative Fallback

Use this if the machine feels sluggish while developing DungeonFit:

```text
llama3.2:3b
```

Why:

- Smaller download and memory footprint.
- Fast enough for casual Discord replies.
- Good instruction-following for simple assistant behavior.

Tradeoff:

- Chinese quality may be weaker than Qwen-family models.

## Ultra-Light Fallback

Use this only if the bot must stay extremely light:

```text
qwen3:1.7b
```

Why:

- Much smaller and lighter.
- Still likely better for Chinese mixed chat than many English-first tiny models.

Tradeoff:

- Weaker reasoning.
- More likely to give shallow answers.

## Not Recommended As Default

Do not use this as the always-on default:

```text
qwen3:8b
```

Reason:

- It should run on an RTX 3050 8GB, but it is more likely to consume enough VRAM/RAM to disturb Godot, browser, and IDE work.
- Better reserved for manual testing or a temporary high-quality mode.

## First Test Order

Pull and test in this order:

```powershell
$env:OLLAMA_MODELS = "D:\TinyDcBot\runtime\ollama\models"
scripts\pull-model.ps1
scripts\test-ollama.ps1
```

If it feels heavy:

```powershell
$env:OLLAMA_MODELS = "D:\TinyDcBot\runtime\ollama\models"
ollama pull llama3.2:3b
ollama run llama3.2:3b
```

If `qwen3.5:4b` feels comfortable, keep it as the MVP default.

## Runtime Policy

For Discord bot usage:

- Keep replies short by default.
- Keep conversation memory off for MVP.
- Add a per-user cooldown.
- Add an Ollama request timeout.
- Do not preload multiple models.
- Stop the model when doing heavier Godot export/build work if needed.
