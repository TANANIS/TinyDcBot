# Storage Policy

## Requirement

TinyDcBot must keep all project-owned files under:

```text
D:\TinyDcBot
```

No bot runtime data, Ollama model data, logs, cache, memory, generated files, or downloaded project dependencies should be placed on `C:\` or any other external directory.

## Approved Project Directories

```text
D:\TinyDcBot
  docs\
  src\
  runtime\
    node\
    ollama\
      bin\
      models\
      logs\
    bot\
      logs\
      cache\
    npm-cache\
```

## Ollama Rule

Ollama must be started with:

```powershell
$env:OLLAMA_MODELS = "D:\TinyDcBot\runtime\ollama\models"
```

The bot should call Ollama through:

```text
http://localhost:11434
```

The first model pull must happen only after `OLLAMA_MODELS` is set in the same environment that starts the Ollama server.

## Preferred Runtime Strategy

Use a project-local Ollama runtime when possible:

```text
D:\TinyDcBot\runtime\ollama\bin
```

Use a project-local Node runtime when possible:

```text
D:\TinyDcBot\runtime\node
```

Avoid relying on normal Windows installers, background services, or PATH runtimes until we verify that all model and runtime data paths are under `D:\TinyDcBot`.

Project scripts reject PATH runtimes by default. To intentionally allow them for a one-off test, set:

```powershell
$env:TINYDCBOT_ALLOW_PATH_RUNTIME = "true"
```

Do not use that override for the strict project-local deployment.

## Not Allowed

Do not intentionally use:

```text
C:\Users\<user>\.ollama
C:\Users\<user>\AppData
C:\ProgramData
%USERPROFILE%\.ollama
%APPDATA%
%LOCALAPPDATA%
```

Do not use Docker Desktop for this MVP unless Docker's own storage location is also proven to stay outside `C:\` and inside an approved project-specific path. For now, Docker is out of scope.

## Verification Before First Pull

Before running `ollama pull`, confirm:

```powershell
$env:OLLAMA_MODELS
```

Expected:

```text
D:\TinyDcBot\runtime\ollama\models
```

Then confirm the directory exists:

```powershell
Test-Path "D:\TinyDcBot\runtime\ollama\models"
```

After pulling a model, inspect:

```powershell
Get-ChildItem "D:\TinyDcBot\runtime\ollama\models" -Recurse
```

Also check that these paths were not created by the project run:

```powershell
Test-Path "$env:USERPROFILE\.ollama"
Test-Path "$env:LOCALAPPDATA\Ollama"
Test-Path "$env:APPDATA\Ollama"
```

If any of those paths appear or change during setup, stop and document what created them before continuing.

## npm Rule

The project `.npmrc` pins npm cache to:

```text
D:\TinyDcBot\runtime\npm-cache
```

Before running `npm install`, confirm:

```powershell
npm config get cache
```

Expected:

```text
D:\TinyDcBot\runtime\npm-cache
```

## Practical Caveat

Some Windows software installers can create installer metadata, user profile config, services, or logs outside the project folder. This project treats that as a blocker unless the behavior is understood and accepted explicitly.

If strict single-folder containment cannot be proven with Ollama on this machine, the fallback design is to replace Ollama with a project-local GGUF runner such as `llama.cpp`, while keeping the Discord bot architecture the same.
