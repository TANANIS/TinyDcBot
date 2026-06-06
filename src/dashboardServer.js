import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { chatOllama } from "./ollamaApi.js";
import { capabilitiesText, getCapabilities, getCapabilitiesPath, isCapabilitiesQuestion } from "./capabilities.js";
import { getContextPath, listContext } from "./contextStore.js";
import { buildPrompt, coerceReplyForUserMessage, getReplyNumPredict } from "./promptMemory.js";
import { addMemory, approveMemoryCandidate, clearAutoMemories, clearMemories, clearMemoryCandidates, describeKnownUserMemory, getAutoMemoryPath, getCandidatesPath, getMemoryCandidates, getMemoryPath, getMemoryUsers, getPersonaPath, isMemoryQuestion, listAutoMemories, listMemories, listPersona, rejectMemoryCandidate, saveMemoryUsers, setPersona } from "./promptMemory.js";
import { addReminder, clearReminders, completeReminder, getRemindersPath, listReminders } from "./reminders.js";
import { getTone, getToneDescription, getTonePath, setTone } from "./tone.js";
import { clearConversationLog, getConversationLogPath, logConversationEvent, readConversationLog } from "./conversationLog.js";
import { getSelfUpdatesPath, selfKnowledgeText } from "./selfKnowledge.js";
import { clearPerformanceLog, getPerformanceLogPath, readPerformanceLog } from "./performanceLog.js";
import { applyDecisionMemory, buildSearchAugmentedPrompt, decideTurn, getAutonomyPath, getAutonomySettings, saveAutonomySettings } from "./turnDecision.js";
import { assertRuntimeSafe, cleanProjectLlamaServers, getRuntimeGuardLogPath, readRuntimeGuardLog, runtimeGuardSnapshot, stopProjectOllamaProcesses } from "./runtimeGuard.js";
import { clearSelfMemory, formatSelfMemoryForPrompt, getSelfMemory, getSelfMemoryPath, learnSelfMemoryFromTurn } from "./selfMemory.js";
import { formatCharacterProfileForPrompt, getCharacterProfile, getCharacterProfilePath, resetCharacterProfile, saveCharacterProfile } from "./characterProfile.js";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboardPath = path.join(projectRoot, "dashboard", "dashboard.html");
const runtimeRoot = path.join(projectRoot, "runtime");
const logRoot = path.join(runtimeRoot, "dashboard", "logs");
const ollamaModels = path.join(runtimeRoot, "ollama", "models");
const nodeExe = path.join(runtimeRoot, "node", "node.exe");
const npmCmd = path.join(runtimeRoot, "node", "npm.cmd");
const ollamaExe = path.join(runtimeRoot, "ollama", "bin", "ollama.exe");
const botEntry = path.join(projectRoot, "src", "index.js");
const stopAllScript = path.join(projectRoot, "scripts", "stop-all.ps1");
let modelName = config.ollamaModel;
const port = Number.parseInt(process.env.TINYDCBOT_DASHBOARD_PORT || "8787", 10);

const logs = {
  dashboard: path.join(logRoot, "dashboard.log"),
  "ollama-out": path.join(logRoot, "ollama.out.log"),
  "ollama-err": path.join(logRoot, "ollama.err.log"),
  "bot-out": path.join(logRoot, "bot.out.log"),
  "bot-err": path.join(logRoot, "bot.err.log"),
};

let ollamaProcess = null;
let botProcess = null;
let botProcessModel = null;

function ensureInsideProject(label, value) {
  const resolved = path.resolve(value);
  const relative = path.relative(projectRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`${label} must stay inside ${projectRoot}: ${value}`);
  return resolved;
}
function ensureRuntime() { ensureInsideProject("runtime", runtimeRoot); ensureInsideProject("logRoot", logRoot); ensureInsideProject("ollamaModels", ollamaModels); fs.mkdirSync(logRoot, { recursive: true }); fs.mkdirSync(ollamaModels, { recursive: true }); }
function maskSecrets(value) { let text = String(value || ""); if (config.discordToken) text = text.replaceAll(config.discordToken, "[DISCORD_TOKEN_REDACTED]"); return text.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[TOKEN_REDACTED]"); }
function writeLog(message) { ensureRuntime(); const line = `[${new Date().toISOString()}] ${maskSecrets(message)}\n`; fs.appendFileSync(logs.dashboard, line, "utf8"); console.log(maskSecrets(message)); }
function exists(file) { return fs.existsSync(file); }
function learnSelfMemorySafe(turn) {
  try {
    return learnSelfMemoryFromTurn(turn);
  } catch (error) {
    writeLog(`Self-memory learning failed: ${error?.message || error}`);
    return [];
  }
}
function readEnvValue(name) {
  const envFile = path.join(projectRoot, ".env");
  if (!exists(envFile)) return "";
  const prefix = `${name}=`;
  const line = fs.readFileSync(envFile, "utf8").split(/\r?\n/).find((item) => item.trimStart().startsWith(prefix));
  return line ? line.trimStart().slice(prefix.length).trim() : "";
}
function modelState() {
  const envModel = readEnvValue("OLLAMA_MODEL") || modelName;
  const botModel = isProcessAlive(botProcess) ? botProcessModel || "" : "";
  return {
    current: modelName,
    envModel,
    botModel,
    modelMismatch: Boolean((envModel && envModel !== modelName) || (botModel && botModel !== modelName)),
  };
}
function createLogStream(file) { ensureInsideProject("log", file); fs.mkdirSync(path.dirname(file), { recursive: true }); return fs.createWriteStream(file, { flags: "a" }); }
function attachProcessLogs(child, outFile, errFile) { const out = createLogStream(outFile); const err = createLogStream(errFile); child.stdout?.pipe(out); child.stderr?.pipe(err); child.on("exit", () => { out.end(); err.end(); }); }
function baseEnv() { return { ...process.env, OLLAMA_MODEL: modelName, OLLAMA_MODELS: ollamaModels, OLLAMA_HOST: "127.0.0.1:11434", npm_config_cache: path.join(runtimeRoot, "npm-cache"), TINYDCBOT_ALLOW_PATH_RUNTIME: "" }; }
function isProcessAlive(child) { return Boolean(child && child.exitCode == null && !child.killed); }
function processSnapshot() { return [{ role: "dashboard", pid: process.pid, running: true, model: modelName }, { role: "bot", pid: botProcess?.pid || null, running: isProcessAlive(botProcess), model: isProcessAlive(botProcess) ? botProcessModel : "" }, { role: "ollama", pid: ollamaProcess?.pid || null, running: isProcessAlive(ollamaProcess), model: modelName }]; }
async function ollamaResponds() { try { return (await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1200) })).ok; } catch { return false; } }
async function hasModel() { try { const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) }); if (!response.ok) return false; const data = await response.json(); return Array.isArray(data.models) && data.models.some((model) => model.name === modelName); } catch { return false; } }
function localModelManifestPath(name) { const raw = String(name || "").trim(); const separator = raw.lastIndexOf(":"); const model = separator >= 0 ? raw.slice(0, separator) : raw; const tag = separator >= 0 ? raw.slice(separator + 1) : "latest"; const modelParts = model.split("/").filter(Boolean); if (!modelParts.length || !tag) return null; if ([...modelParts, tag].some((part) => part === "." || part === ".." || part.includes("\\"))) return null; const manifestParts = modelParts.length === 1 ? ["library", modelParts[0]] : modelParts; return ensureInsideProject("model manifest", path.join(ollamaModels, "manifests", "registry.ollama.ai", ...manifestParts, tag)); }
function hasLocalModelManifest(name = modelName) { const file = localModelManifestPath(name); return Boolean(file && exists(file)); }
function normalizeModelName(value) { const text = String(value || "").trim(); if (!text || text.length > 160) throw new Error("Model name is required."); if (/[\\\s]|(^|\/)\.\.?(\/|$)/.test(text)) throw new Error("Invalid model name."); const separator = text.lastIndexOf(":"); const model = separator >= 0 ? text.slice(0, separator) : text; const tag = separator >= 0 ? text.slice(separator + 1) : "latest"; if (!model || !tag || !/^[A-Za-z0-9._/-]+$/.test(model) || !/^[A-Za-z0-9._-]+$/.test(tag)) throw new Error("Invalid model name."); return `${model}:${tag}`; }
function manifestNameFromPath(root, file) { const parts = path.relative(root, file).split(path.sep).filter(Boolean); if (parts.length < 2) return null; const tag = parts.pop(); const modelParts = parts[0] === "library" && parts.length >= 2 ? parts.slice(1) : parts; return modelParts.length ? `${modelParts.join("/")}:${tag}` : null; }
function manifestModelSize(file) { try { const data = JSON.parse(fs.readFileSync(file, "utf8")); return Array.isArray(data.layers) ? data.layers.reduce((sum, layer) => sum + (Number.parseInt(layer.size, 10) || 0), 0) : 0; } catch { return 0; } }
function walkFiles(root) { if (!exists(root)) return []; const found = []; for (const entry of fs.readdirSync(root, { withFileTypes: true })) { const full = path.join(root, entry.name); if (entry.isDirectory()) found.push(...walkFiles(full)); else if (entry.isFile()) found.push(full); } return found; }
function localModels() { const root = path.join(ollamaModels, "manifests", "registry.ollama.ai"); ensureInsideProject("model manifests", root); return walkFiles(root).map((file) => ({ name: manifestNameFromPath(root, file), size: manifestModelSize(file), local: true, manifest: file })).filter((model) => model.name); }
async function ollamaTagModels() { try { const response = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(1500) }); if (!response.ok) return []; const data = await response.json(); return Array.isArray(data.models) ? data.models.map((model) => ({ name: model.name, size: model.size || 0, modifiedAt: model.modified_at || "", digest: model.digest || "", runningTag: true })) : []; } catch { return []; } }
async function listModels() { const byName = new Map(); for (const model of localModels()) byName.set(model.name, model); for (const model of await ollamaTagModels()) byName.set(model.name, { ...(byName.get(model.name) || {}), ...model, local: byName.get(model.name)?.local || false }); return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name)).map((model) => ({ ...model, active: model.name === modelName })); }
function setCurrentModel(name) { modelName = normalizeModelName(name); config.ollamaModel = modelName; process.env.OLLAMA_MODEL = modelName; return modelName; }
function writeEnvValue(name, value) { const envFile = path.join(projectRoot, ".env"); const lines = exists(envFile) ? fs.readFileSync(envFile, "utf8").split(/\r?\n/) : []; let found = false; const next = lines.map((line) => { if (line.trimStart().startsWith(`${name}=`)) { found = true; return `${name}=${value}`; } return line; }); if (!found) next.push(`${name}=${value}`); fs.writeFileSync(envFile, `${next.join("\n").replace(/\n*$/, "")}\n`, "utf8"); }
async function waitForExit(child, timeoutMs = 5000) { if (!isProcessAlive(child)) return true; const started = Date.now(); while (Date.now() - started < timeoutMs) { if (!isProcessAlive(child)) return true; await new Promise((resolve) => setTimeout(resolve, 150)); } return !isProcessAlive(child); }
function runtimeKillSummary(result) {
  const killed = result?.killed?.length || 0;
  const skipped = result?.skipped?.length || 0;
  return `killed=${killed} skipped=${skipped}`;
}
async function switchModel(name) {
  const nextModel = normalizeModelName(name);
  const available = await listModels();
  if (!available.some((model) => model.name === nextModel)) throw new Error(`${nextModel} is not installed in the project-local Ollama models.`);
  const guardBefore = await runtimeGuardSnapshot({ action: "switch-model" });
  const wasBotRunning = isProcessAlive(botProcess);
  const shouldRestartOllama = isProcessAlive(ollamaProcess) || (await ollamaResponds()) || guardBefore.processes.projectOllama.length > 0 || guardBefore.processes.projectLlamaServers.length > 0;

  if (wasBotRunning) {
    stopProcess(botProcess, "Discord bot");
    const stopped = await waitForExit(botProcess);
    if (!stopped) throw new Error("Bot stop timed out; model switch was blocked to avoid a split runtime.");
    botProcess = null;
    botProcessModel = null;
  }

  writeEnvValue("OLLAMA_MODEL", nextModel);
  setCurrentModel(nextModel);

  let cleanupMessage = "No project-local Ollama cleanup needed.";
  if (shouldRestartOllama) {
    const stoppedRuntime = await stopProjectOllamaProcesses({ includeLlamaServers: true, reason: "model-switch" });
    ollamaProcess = null;
    cleanupMessage = `Project-local Ollama cleaned (${runtimeKillSummary(stoppedRuntime)}).`;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await startOllama();
  }

  const botMessage = wasBotRunning ? await startBot() : "Bot will use this model on next start.";
  writeLog(`Model switched to ${nextModel}. ${cleanupMessage} ${botMessage}`);
  return `Model switched to ${nextModel}. ${cleanupMessage} ${botMessage}`;
}
async function startOllama({ skipGuard = false } = {}) {
  ensureRuntime();
  if (!exists(ollamaExe)) throw new Error(`Missing ${ollamaExe}`);
  if (!skipGuard) await assertRuntimeSafe("start-ollama");
  if (await ollamaResponds()) return "Ollama is already responding.";
  if (isProcessAlive(ollamaProcess)) return "Ollama already started by dashboard.";
  ollamaProcess = spawn(ollamaExe, ["serve"], { cwd: path.dirname(ollamaExe), env: baseEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  attachProcessLogs(ollamaProcess, logs["ollama-out"], logs["ollama-err"]);
  ollamaProcess.on("exit", (code, signal) => writeLog(`Ollama exited code=${code} signal=${signal}`));
  writeLog(`Ollama started pid=${ollamaProcess.pid}`);
  return "Ollama starting.";
}
function stopProcess(child, name) { if (!isProcessAlive(child)) return `${name} is not running.`; child.kill(); writeLog(`${name} stop requested pid=${child.pid}`); return `${name} stop requested.`; }
async function stopOllamaRuntime(reason = "dashboard-stop") {
  const dashboardMessage = stopProcess(ollamaProcess, "Ollama");
  if (isProcessAlive(ollamaProcess)) await waitForExit(ollamaProcess, 1500);
  const stoppedRuntime = await stopProjectOllamaProcesses({ includeLlamaServers: true, reason });
  ollamaProcess = null;
  return `${dashboardMessage} Project-local Ollama cleanup ${runtimeKillSummary(stoppedRuntime)}.`;
}
async function restartOllamaRuntime() {
  const wasBotRunning = isProcessAlive(botProcess);
  if (wasBotRunning) {
    stopProcess(botProcess, "Discord bot");
    const stopped = await waitForExit(botProcess);
    if (!stopped) throw new Error("Bot stop timed out; restart blocked to avoid duplicate model loads.");
    botProcess = null;
    botProcessModel = null;
  }
  const stoppedRuntime = await stopProjectOllamaProcesses({ includeLlamaServers: true, reason: "dashboard-restart" });
  ollamaProcess = null;
  await new Promise((resolve) => setTimeout(resolve, 500));
  const ollamaMessage = await startOllama();
  const botMessage = wasBotRunning ? await startBot() : "Bot was not running.";
  return `Ollama restarted. ${runtimeKillSummary(stoppedRuntime)}. ${ollamaMessage} ${botMessage}`;
}
async function startBot() {
  ensureRuntime();
  if (!exists(nodeExe)) throw new Error(`Missing ${nodeExe}`);
  if (!exists(path.join(projectRoot, ".env"))) throw new Error("Missing .env");
  if (!exists(path.join(projectRoot, "node_modules"))) throw new Error("Missing node_modules");
  if (isProcessAlive(botProcess)) return `Discord bot already running with ${botProcessModel || "unknown model"}.`;
  await assertRuntimeSafe("start-bot");
  const launchModel = modelName;
  const child = spawn(nodeExe, [botEntry], { cwd: projectRoot, env: baseEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  botProcess = child;
  botProcessModel = launchModel;
  attachProcessLogs(child, logs["bot-out"], logs["bot-err"]);
  child.on("exit", (code, signal) => {
    writeLog(`Discord bot exited code=${code} signal=${signal}`);
    if (botProcess === child) {
      botProcess = null;
      botProcessModel = null;
    }
  });
  writeLog(`Discord bot started pid=${child.pid} model=${launchModel}`);
  return `Discord bot starting with ${launchModel}.`;
}
function runCommand(command, args, logName) { ensureRuntime(); return new Promise((resolve, reject) => { const out = createLogStream(logs[logName]); const err = createLogStream(logs.dashboard); const child = spawn(command, args, { cwd: projectRoot, env: baseEnv(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); child.stdout?.pipe(out); child.stderr?.pipe(err); child.on("error", reject); child.on("exit", (code) => { out.end(); err.end(); code === 0 ? resolve() : reject(new Error(`${path.basename(command)} exited with ${code}`)); }); }); }
async function waitForOllama() { for (let i = 0; i < 30; i += 1) { if (await ollamaResponds()) return; await new Promise((resolve) => setTimeout(resolve, 500)); } throw new Error("Ollama did not respond on 127.0.0.1:11434."); }
async function pullModel() { await assertRuntimeSafe("pull-model"); await startOllama(); await waitForOllama(); await runCommand(ollamaExe, ["pull", modelName], "ollama-out"); return `${modelName} is ready.`; }
async function testModel() {
  await assertRuntimeSafe("test-model");
  await startOllama();
  await waitForOllama();
  const data = await chatOllama({
    numPredict: 128,
    messages: [{ role: "user", content: "請用繁體中文簡短回覆：模型測試成功。" }],
  });
  writeLog(`Model test response: ${String(data?.message?.content || "").slice(0, 120)}`);
  return "Model test completed.";
}
async function chatWithModel(prompt, useSearch = false) {
  const content = String(prompt || "").trim();
  if (!content) throw new Error("Message cannot be empty.");
  if (content.length > 4000) throw new Error("Message is too long.");
  if (isCapabilitiesQuestion(content)) return capabilitiesText();
  const speaker = { id: "dashboard", username: "dashboard", displayName: "Dashboard", channelId: "dashboard", guildId: "local" };
  if (isMemoryQuestion(content)) {
    const answer = describeKnownUserMemory(speaker);
    logConversationEvent({
      type: "dashboard-chat",
      source: "dashboard",
      channelId: "dashboard",
      userId: "dashboard",
      displayName: "Dashboard",
      input: content,
      reply: answer,
      searched: false,
      memoryItems: [],
      meta: { handledBy: "memory-question", selfMemoryItems: [] },
    });
    return answer;
  }
  await assertRuntimeSafe("chat");
  await startOllama();
  await waitForOllama();
  const decision = await decideTurn({ message: content, speaker, source: "dashboard", forceSearch: useSearch });
  const memoryItems = applyDecisionMemory(decision, speaker, content);
  const prepared = await buildSearchAugmentedPrompt(content, decision);
  const data = await chatOllama({
    numPredict: getReplyNumPredict(content, 512),
    messages: [{ role: "user", content: buildPrompt(prepared.prompt, { speaker, rawUserMessage: content }) }],
  });
  const answer = coerceReplyForUserMessage(content, String(data?.message?.content || "").trim());
  if (!answer) throw new Error("Ollama returned an empty final response.");
  const selfMemoryItems = learnSelfMemorySafe({
    input: content,
    reply: answer,
    speaker,
    source: "dashboard",
  });
  logConversationEvent({
    type: "dashboard-chat",
    source: "dashboard",
    channelId: "dashboard",
    userId: "dashboard",
    displayName: "Dashboard",
    input: content,
    reply: answer,
    searched: prepared.searched,
    memoryItems,
    meta: {
      autonomyDecision: decision,
      searchQuery: prepared.searchQuery,
      searchError: prepared.searchError,
      searchResultCount: prepared.searchResults?.length || 0,
      selfMemoryItems,
    },
  });
  writeLog(`Dashboard chat completed. inputChars=${content.length} outputChars=${answer.length} search=${prepared.searched} query=${prepared.searchQuery || ""}`);
  return answer;
}
function tokenHealth() { return { present: Boolean(config.discordToken), length: config.discordToken ? config.discordToken.length : 0, masked: config.discordToken ? "present-redacted" : "missing" }; }
async function status() {
  ensureRuntime();
  const ollamaRunning = await ollamaResponds();
  const modelPulled = ollamaRunning ? await hasModel() : hasLocalModelManifest();
  const models = modelState();
  return {
    ok: true,
    projectRoot,
    model: modelName,
    envModel: models.envModel,
    botModel: models.botModel,
    modelMismatch: models.modelMismatch,
    ollamaModels,
    node: exists(nodeExe) ? nodeExe : "",
    npm: exists(npmCmd) ? npmCmd : "",
    ollama: exists(ollamaExe) ? ollamaExe : "",
    hasEnv: exists(path.join(projectRoot, ".env")),
    hasNodeModules: exists(path.join(projectRoot, "node_modules")),
    hasModel: modelPulled,
    personaPath: getPersonaPath(),
    memoryPath: getMemoryPath(),
    autoMemoryPath: getAutoMemoryPath(),
    candidatesPath: getCandidatesPath(),
    contextPath: getContextPath(),
    remindersPath: getRemindersPath(),
    capabilitiesPath: getCapabilitiesPath(),
    selfUpdatesPath: getSelfUpdatesPath(),
    conversationLogPath: getConversationLogPath(),
    performancePath: getPerformanceLogPath(),
    runtimeGuardPath: getRuntimeGuardLogPath(),
    autonomyPath: getAutonomyPath(),
    selfMemoryPath: getSelfMemoryPath(),
    characterPath: getCharacterProfilePath(),
    characterIntensity: getCharacterProfile().loreIntensity,
    tonePath: getTonePath(),
    tone: getTone(),
    toneDescription: getToneDescription(),
    token: tokenHealth(),
    ollamaRunning,
    botRunning: isProcessAlive(botProcess),
    storageOk: true,
    processCount: processSnapshot().length,
  };
}
function sendJson(response, code, payload) { const body = JSON.stringify(payload); response.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body), "Cache-Control": "no-store" }); response.end(body); }
function characterSnapshot() { const data = getCharacterProfile(); return { ok: true, path: getCharacterProfilePath(), data, text: formatCharacterProfileForPrompt({ type: "meta" }) }; }
function selfMemorySnapshot() { return { ok: true, path: getSelfMemoryPath(), data: getSelfMemory(), text: formatSelfMemoryForPrompt() }; }
function memorySnapshot() { return { ok: true, persona: { path: getPersonaPath(), text: listPersona() }, manual: { path: getMemoryPath(), text: listMemories() }, auto: { path: getAutoMemoryPath(), users: getMemoryUsers(), text: listAutoMemories() }, candidates: { path: getCandidatesPath(), ...getMemoryCandidates() }, self: selfMemorySnapshot() }; }
function autonomySnapshot() { return { ok: true, path: getAutonomyPath(), settings: getAutonomySettings() }; }
async function autonomyPreview(body = {}) {
  const message = String(body.message || "").trim();
  if (!message) throw new Error("Preview message cannot be empty.");
  await assertRuntimeSafe("autonomy-preview");
  await startOllama();
  await waitForOllama();
  const speaker = { id: "dashboard-preview", username: "dashboard", displayName: "Dashboard Preview", channelId: "dashboard", guildId: "local" };
  const decision = await decideTurn({ message, speaker, source: "dashboard-preview", forceSearch: Boolean(body.forceSearch), dryRun: true });
  return { ok: true, decision };
}
function performanceSnapshot(limit = 80) {
  const lines = readPerformanceLog(limit);
  const items = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line, error: "Invalid JSON log line" };
    }
  });
  return { ok: true, path: getPerformanceLogPath(), lines, items };
}
function runtimeGuardLogSnapshot(limit = 80) {
  const lines = readRuntimeGuardLog(limit);
  const items = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { raw: line, error: "Invalid JSON log line" };
    }
  });
  return { ok: true, path: getRuntimeGuardLogPath(), lines, items };
}
function readLog(name) { if (!Object.hasOwn(logs, name)) throw new Error("Unknown log."); const file = logs[name]; ensureInsideProject("log", file); if (!exists(file)) return ""; const buffer = fs.readFileSync(file); return maskSecrets(buffer.subarray(Math.max(0, buffer.length - 30000)).toString("utf8")); }
function clearLogs(name = "") { if (name) { if (!Object.hasOwn(logs, name)) throw new Error("Unknown log."); fs.writeFileSync(logs[name], "", "utf8"); return; } for (const file of Object.values(logs)) fs.writeFileSync(file, "", "utf8"); }
async function readJsonBody(request) { const chunks = []; for await (const chunk of request) chunks.push(chunk); if (chunks.length === 0) return {}; const raw = Buffer.concat(chunks).toString("utf8"); if (raw.length > 250000) throw new Error("Request body is too large."); return JSON.parse(raw); }
async function stopAll() { const { stdout, stderr } = await execFileAsync("powershell", ["-ExecutionPolicy", "Bypass", "-NoProfile", "-File", stopAllScript], { cwd: projectRoot, windowsHide: true }); return maskSecrets(`${stdout}\n${stderr}`.trim()); }
async function route(request, response) {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  try {
    if (request.method === "GET" && url.pathname === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      response.end(fs.readFileSync(dashboardPath));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/status") return sendJson(response, 200, await status());
    if (request.method === "GET" && url.pathname === "/api/models") {
      const models = modelState();
      return sendJson(response, 200, { ok: true, current: modelName, envModel: models.envModel, botModel: models.botModel, modelMismatch: models.modelMismatch, ollamaRunning: await ollamaResponds(), models: await listModels() });
    }
    if (request.method === "GET" && url.pathname === "/api/processes") return sendJson(response, 200, { ok: true, processes: processSnapshot() });
    if (request.method === "GET" && url.pathname === "/api/runtime-guard") return sendJson(response, 200, await runtimeGuardSnapshot({ action: url.searchParams.get("action") || "status" }));
    if (request.method === "GET" && url.pathname === "/api/runtime-guard-log") return sendJson(response, 200, runtimeGuardLogSnapshot(Number.parseInt(url.searchParams.get("limit") || "80", 10)));
    if (request.method === "GET" && url.pathname === "/api/log") return sendJson(response, 200, { ok: true, text: readLog(url.searchParams.get("name") || "dashboard") });
    if (request.method === "GET" && url.pathname === "/api/performance") return sendJson(response, 200, performanceSnapshot(Number.parseInt(url.searchParams.get("limit") || "80", 10)));
    if (request.method === "GET" && url.pathname === "/api/autonomy") return sendJson(response, 200, autonomySnapshot());
    if (request.method === "GET" && url.pathname === "/api/character") return sendJson(response, 200, characterSnapshot());
    if (request.method === "GET" && url.pathname === "/api/memories") return sendJson(response, 200, memorySnapshot());
    if (request.method === "GET" && url.pathname === "/api/self-memory") return sendJson(response, 200, selfMemorySnapshot());
    if (request.method === "GET" && url.pathname === "/api/context") return sendJson(response, 200, { ok: true, path: getContextPath(), context: listContext() });
    if (request.method === "GET" && url.pathname === "/api/tone") return sendJson(response, 200, { ok: true, level: getTone(), description: getToneDescription(), path: getTonePath() });
    if (request.method === "GET" && url.pathname === "/api/capabilities") return sendJson(response, 200, { ok: true, path: getCapabilitiesPath(), data: getCapabilities(), text: capabilitiesText() });
    if (request.method === "GET" && url.pathname === "/api/self") return sendJson(response, 200, { ok: true, path: getSelfUpdatesPath(), text: selfKnowledgeText() });
    if (request.method === "GET" && url.pathname === "/api/conversations") return sendJson(response, 200, { ok: true, path: getConversationLogPath(), items: readConversationLog(Number.parseInt(url.searchParams.get("limit") || "120", 10)) });
    if (request.method === "GET" && url.pathname === "/api/reminders") return sendJson(response, 200, { ok: true, path: getRemindersPath(), reminders: listReminders() });

    if (request.method === "POST") {
      if (url.pathname === "/api/model") {
        const body = await readJsonBody(request);
        const message = await switchModel(body.model);
        const models = modelState();
        return sendJson(response, 200, { ok: true, current: modelName, envModel: models.envModel, botModel: models.botModel, modelMismatch: models.modelMismatch, message });
      }
      if (url.pathname === "/api/chat") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, { ok: true, answer: await chatWithModel(body.message, Boolean(body.search)) });
      }
      if (url.pathname === "/api/autonomy") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, { ok: true, path: getAutonomyPath(), settings: saveAutonomySettings(body) });
      }
      if (url.pathname === "/api/autonomy/preview") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, await autonomyPreview(body));
      }
      if (url.pathname === "/api/character") {
        const body = await readJsonBody(request);
        const data = saveCharacterProfile(body.profile || body);
        return sendJson(response, 200, { ...characterSnapshot(), data, message: "Character bible saved." });
      }
      if (url.pathname === "/api/character/reset") {
        const data = resetCharacterProfile();
        return sendJson(response, 200, { ...characterSnapshot(), data, message: "Character bible reset." });
      }
      if (url.pathname === "/api/persona") {
        const body = await readJsonBody(request);
        setPersona(body.text);
        return sendJson(response, 200, { ok: true, message: "Persona saved.", memories: memorySnapshot() });
      }
      if (url.pathname === "/api/memory/manual-add") {
        const body = await readJsonBody(request);
        addMemory(body.text);
        return sendJson(response, 200, { ok: true, message: "Manual memory added.", memories: memorySnapshot() });
      }
      if (url.pathname === "/api/memory/manual-clear") {
        clearMemories();
        return sendJson(response, 200, { ok: true, message: "Manual long-term memory cleared.", memories: memorySnapshot() });
      }
      if (url.pathname === "/api/memory/auto-clear") {
        const body = await readJsonBody(request);
        clearAutoMemories(String(body.userId || "").trim());
        return sendJson(response, 200, { ok: true, message: body.userId ? "Auto memory cleared for user." : "All auto memory cleared.", memories: memorySnapshot() });
      }
      if (url.pathname === "/api/memory/users") {
        const body = await readJsonBody(request);
        return sendJson(response, 200, { ok: true, users: saveMemoryUsers(body) });
      }
      if (url.pathname === "/api/memory/candidates") {
        const body = await readJsonBody(request);
        if (body.action === "approve") approveMemoryCandidate(body.id);
        else if (body.action === "reject") rejectMemoryCandidate(body.id);
        else if (body.action === "clear") clearMemoryCandidates();
        else throw new Error("Unknown candidate action.");
        return sendJson(response, 200, memorySnapshot());
      }
      if (url.pathname === "/api/self-memory/clear") {
        const body = await readJsonBody(request);
        clearSelfMemory(String(body.section || "").trim());
        return sendJson(response, 200, selfMemorySnapshot());
      }
      if (url.pathname === "/api/tone") {
        const body = await readJsonBody(request);
        const level = setTone(body.level);
        return sendJson(response, 200, { ok: true, level, description: getToneDescription(level) });
      }
      if (url.pathname === "/api/reminders") {
        const body = await readJsonBody(request);
        if (body.action === "add") return sendJson(response, 200, { ok: true, reminder: addReminder({ userId: body.userId || "dashboard", channelId: body.channelId || "dashboard", text: body.text, dueAt: body.time }) });
        if (body.action === "done") return sendJson(response, 200, { ok: true, reminder: completeReminder(body.id) });
        if (body.action === "clear") {
          clearReminders(body.userId || "");
          return sendJson(response, 200, { ok: true, reminders: listReminders() });
        }
        throw new Error("Unknown reminder action.");
      }
      if (url.pathname === "/api/logs/clear") {
        const body = await readJsonBody(request);
        clearLogs(body.name || "");
        return sendJson(response, 200, { ok: true, message: "Logs cleared." });
      }
      if (url.pathname === "/api/performance/clear") {
        clearPerformanceLog();
        return sendJson(response, 200, { ok: true, message: "Performance log cleared." });
      }
      if (url.pathname === "/api/runtime-guard/clean-orphans") {
        const result = await cleanProjectLlamaServers({ reason: "dashboard-clean-orphans" });
        return sendJson(response, 200, { ...result, message: `Runtime guard cleanup finished (${runtimeKillSummary(result)}).` });
      }
      if (url.pathname === "/api/runtime-guard/restart-ollama") {
        return sendJson(response, 200, { ok: true, message: await restartOllamaRuntime() });
      }
      if (url.pathname === "/api/conversations/clear") {
        clearConversationLog();
        return sendJson(response, 200, { ok: true, message: "Conversation log cleared." });
      }
      if (url.pathname === "/api/stop-all") return sendJson(response, 200, { ok: true, message: await stopAll() });
      const actions = {
        "/api/start-ollama": async () => startOllama(),
        "/api/stop-ollama": async () => stopOllamaRuntime(),
        "/api/pull-model": pullModel,
        "/api/test-model": testModel,
        "/api/start-bot": async () => startBot(),
        "/api/stop-bot": async () => stopProcess(botProcess, "Discord bot"),
      };
      const action = actions[url.pathname];
      if (action) return sendJson(response, 200, { ok: true, message: await action() });
    }
    sendJson(response, 404, { ok: false, error: "Not found" });
  } catch (error) {
    writeLog(`ERROR ${error.stack || error.message}`);
    sendJson(response, 500, { ok: false, error: error.message });
  }
}
ensureRuntime(); writeLog("Dashboard server starting."); const server = http.createServer((request, response) => route(request, response)); server.listen(port, "127.0.0.1", () => writeLog(`Dashboard listening on http://127.0.0.1:${port}`)); process.on("SIGINT", () => { stopProcess(botProcess, "Discord bot"); stopProcess(ollamaProcess, "Ollama"); process.exit(0); });
