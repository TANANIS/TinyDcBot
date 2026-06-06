import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";

const execFileAsync = promisify(execFile);

const projectRoot = config.projectRoot;
const runtimeRoot = path.join(projectRoot, "runtime");
const ollamaRoot = path.join(runtimeRoot, "ollama");
const nodeRoot = path.join(runtimeRoot, "node");
const guardLogPath = path.join(runtimeRoot, "dashboard", "logs", "runtime-guard.jsonl");

const MODEL_USE_ACTIONS = new Set(["start-bot", "test-model", "chat", "autonomy-preview"]);
const OLLAMA_START_ACTIONS = new Set(["start-ollama", "pull-model"]);

function inside(value, root) {
  if (!value) return false;
  const resolved = path.resolve(String(value));
  const relative = path.relative(path.resolve(root), resolved);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeProcessName(value) {
  const name = String(value || "").trim();
  if (!name) return "";
  return name.toLowerCase().endsWith(".exe") ? name.toLowerCase() : `${name.toLowerCase()}.exe`;
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function windowsProcesses() {
  if (process.platform !== "win32") return [];

  const script = `
$names = @('ollama','llama-server','node')
$items = @()
foreach ($p in Get-Process -Name $names -ErrorAction SilentlyContinue) {
  $item = [ordered]@{
    pid = $p.Id
    name = ($p.ProcessName + '.exe')
    path = $null
    startTime = $null
    workingSetMb = [Math]::Round($p.WorkingSet64 / 1MB, 1)
    cpuSeconds = $null
  }
  try { $item.path = $p.Path } catch {}
  try { $item.startTime = $p.StartTime.ToString('o') } catch {}
  try { $item.cpuSeconds = [Math]::Round($p.CPU, 2) } catch {}
  $items += [pscustomobject]$item
}
$items | ConvertTo-Json -Depth 4
`.trim();

  try {
    const { stdout } = await execFileAsync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 5000 },
    );
    return asArray(safeJsonParse(stdout.trim(), [])).map((item) => ({
      pid: Number.parseInt(item.pid, 10),
      name: normalizeProcessName(item.name),
      path: item.path || "",
      startTime: item.startTime || "",
      workingSetMb: Number.isFinite(Number(item.workingSetMb)) ? Number(item.workingSetMb) : null,
      cpuSeconds: Number.isFinite(Number(item.cpuSeconds)) ? Number(item.cpuSeconds) : null,
      projectLocal: inside(item.path, projectRoot),
      projectOllama: inside(item.path, ollamaRoot),
      projectNode: inside(item.path, nodeRoot),
    })).filter((item) => Number.isInteger(item.pid));
  } catch (error) {
    return [{ error: error?.message || String(error) }];
  }
}

async function gpuSnapshot() {
  try {
    const { stdout } = await execFileAsync(
      "nvidia-smi",
      ["--query-gpu=memory.total,memory.used,memory.free,utilization.gpu", "--format=csv,noheader,nounits"],
      { windowsHide: true, timeout: 3000 },
    );
    const rows = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [total, used, free, utilization] = line.split(",").map((part) => Number.parseInt(part.trim(), 10));
      return { totalMb: total, usedMb: used, freeMb: free, utilizationPct: utilization };
    }).filter((row) => Number.isFinite(row.freeMb));
    if (!rows.length) return { available: false, error: "nvidia-smi returned no GPU rows" };
    const primary = rows.reduce((best, row) => (row.freeMb > best.freeMb ? row : best), rows[0]);
    return { available: true, ...primary, gpus: rows };
  } catch (error) {
    return { available: false, error: error?.message || String(error) };
  }
}

async function ollamaPsSnapshot() {
  try {
    const response = await fetch(new URL("/api/ps", config.ollamaBaseUrl), { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return { responds: false, error: `HTTP ${response.status}`, models: [] };
    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((model) => ({
      name: model.name || "",
      size: model.size || 0,
      sizeVram: model.size_vram || 0,
      expiresAt: model.expires_at || "",
      digest: model.digest || "",
    })) : [];
    return { responds: true, models };
  } catch (error) {
    return { responds: false, error: error?.message || String(error), models: [] };
  }
}

function runtimeRisks(snapshot, action = "status") {
  const risks = [];
  const projectOllama = snapshot.processes.projectOllama;
  const projectLlamaServers = snapshot.processes.projectLlamaServers;
  const loadedModels = snapshot.ollama.models || [];

  if (projectOllama.length > 1) {
    risks.push({
      code: "DUPLICATE_OLLAMA_SERVER",
      severity: "warn",
      blocking: OLLAMA_START_ACTIONS.has(action) || MODEL_USE_ACTIONS.has(action),
      message: `Found ${projectOllama.length} project-local ollama.exe processes.`,
    });
  }

  if (projectLlamaServers.length > 1) {
    risks.push({
      code: "DUPLICATE_LLAMA_SERVER",
      severity: "danger",
      blocking: OLLAMA_START_ACTIONS.has(action) || MODEL_USE_ACTIONS.has(action),
      message: `Found ${projectLlamaServers.length} project-local llama-server.exe processes.`,
    });
  }

  if (projectLlamaServers.length > 0 && (!snapshot.ollama.responds || loadedModels.length === 0)) {
    risks.push({
      code: "ORPHAN_LLAMA_SERVER",
      severity: "danger",
      blocking: OLLAMA_START_ACTIONS.has(action) || MODEL_USE_ACTIONS.has(action),
      message: "Project-local llama-server.exe is using resources, but Ollama does not report a loaded model.",
    });
  }

  if (snapshot.gpu.available && Number.isFinite(snapshot.gpu.freeMb) && snapshot.gpu.freeMb < config.ollamaMinFreeVramMb) {
    risks.push({
      code: "LOW_FREE_VRAM",
      severity: "warn",
      blocking: MODEL_USE_ACTIONS.has(action),
      message: `Free VRAM ${snapshot.gpu.freeMb} MB is below OLLAMA_MIN_FREE_VRAM_MB=${config.ollamaMinFreeVramMb}.`,
    });
  }

  return risks;
}

export function getRuntimeGuardLogPath() {
  return guardLogPath;
}

export function readRuntimeGuardLog(limit = 80) {
  if (!fs.existsSync(guardLogPath)) return [];
  const lines = fs.readFileSync(guardLogPath, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(Number.parseInt(limit, 10) || 80, 300)));
}

export function logRuntimeGuardEvent(event) {
  fs.mkdirSync(path.dirname(guardLogPath), { recursive: true });
  fs.appendFileSync(guardLogPath, `${JSON.stringify({ ts: new Date().toISOString(), ...event })}\n`, "utf8");
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasTransientStartupRisk(snapshot) {
  return snapshot.blockingRisks.some((risk) => ["ORPHAN_LLAMA_SERVER", "DUPLICATE_OLLAMA_SERVER"].includes(risk.code));
}

export async function runtimeGuardSnapshot({ action = "status" } = {}) {
  const [allProcesses, gpu, ollama] = await Promise.all([windowsProcesses(), gpuSnapshot(), ollamaPsSnapshot()]);
  const realProcesses = allProcesses.filter((item) => !item.error);
  const processErrors = allProcesses.filter((item) => item.error).map((item) => item.error);
  const projectOllama = realProcesses.filter((item) => item.name === "ollama.exe" && item.projectOllama);
  const projectLlamaServers = realProcesses.filter((item) => item.name === "llama-server.exe" && item.projectOllama);
  const projectNode = realProcesses.filter((item) => item.name === "node.exe" && item.projectNode);
  const unknownRelevant = realProcesses.filter((item) => ["ollama.exe", "llama-server.exe", "node.exe"].includes(item.name) && !item.projectLocal);
  const snapshot = {
    ok: true,
    action,
    projectRoot,
    ollamaRoot,
    nodeRoot,
    guardLogPath,
    minFreeVramMb: config.ollamaMinFreeVramMb,
    gpu,
    ollama,
    processes: {
      projectOllama,
      projectLlamaServers,
      projectNode,
      unknownRelevant,
      errors: processErrors,
    },
  };
  const risks = runtimeRisks(snapshot, action);
  return {
    ...snapshot,
    risks,
    blockingRisks: risks.filter((risk) => risk.blocking),
    safe: risks.every((risk) => !risk.blocking),
  };
}

export async function assertRuntimeSafe(action) {
  let snapshot = await runtimeGuardSnapshot({ action });
  if (!snapshot.safe && hasTransientStartupRisk(snapshot)) {
    await delay(2500);
    snapshot = await runtimeGuardSnapshot({ action });
  }
  logRuntimeGuardEvent({
    event: "preflight",
    action,
    safe: snapshot.safe,
    risks: snapshot.risks.map((risk) => risk.code),
    freeVramMb: snapshot.gpu.available ? snapshot.gpu.freeMb : null,
    projectOllamaPids: snapshot.processes.projectOllama.map((item) => item.pid),
    projectLlamaPids: snapshot.processes.projectLlamaServers.map((item) => item.pid),
  });
  if (!snapshot.safe) {
    const details = snapshot.blockingRisks.map((risk) => `${risk.code}: ${risk.message}`).join(" ");
    const error = new Error(`Runtime guard blocked ${action}. ${details}`);
    error.code = "RUNTIME_GUARD_BLOCKED";
    error.snapshot = snapshot;
    throw error;
  }
  return snapshot;
}

async function killPid(pid) {
  await execFileAsync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, timeout: 5000 });
}

function killableProjectProcess(processInfo) {
  return Number.isInteger(processInfo.pid) && processInfo.path && (inside(processInfo.path, ollamaRoot) || inside(processInfo.path, nodeRoot));
}

export async function cleanProjectLlamaServers({ reason = "manual" } = {}) {
  const before = await runtimeGuardSnapshot({ action: "clean-orphans" });
  const shouldClean = before.risks.some((risk) => ["ORPHAN_LLAMA_SERVER", "DUPLICATE_LLAMA_SERVER"].includes(risk.code));
  const targets = shouldClean ? before.processes.projectLlamaServers.filter(killableProjectProcess) : [];
  const killed = [];
  const skipped = [];
  for (const target of targets) {
    try {
      await killPid(target.pid);
      killed.push({ pid: target.pid, name: target.name, path: target.path });
    } catch (error) {
      skipped.push({ pid: target.pid, name: target.name, path: target.path, error: error?.message || String(error) });
    }
  }
  const after = await runtimeGuardSnapshot({ action: "clean-orphans" });
  logRuntimeGuardEvent({ event: "clean-llama", reason, killed, skipped, risksBefore: before.risks.map((risk) => risk.code), risksAfter: after.risks.map((risk) => risk.code) });
  return { ok: true, reason, killed, skipped, before, after };
}

export async function stopProjectOllamaProcesses({ includeLlamaServers = true, reason = "manual" } = {}) {
  const before = await runtimeGuardSnapshot({ action: "stop-ollama" });
  const targets = [
    ...before.processes.projectOllama,
    ...(includeLlamaServers ? before.processes.projectLlamaServers : []),
  ].filter(killableProjectProcess);
  const killed = [];
  const skipped = [];
  for (const target of targets) {
    try {
      await killPid(target.pid);
      killed.push({ pid: target.pid, name: target.name, path: target.path });
    } catch (error) {
      skipped.push({ pid: target.pid, name: target.name, path: target.path, error: error?.message || String(error) });
    }
  }
  const after = await runtimeGuardSnapshot({ action: "stop-ollama" });
  logRuntimeGuardEvent({ event: "stop-project-ollama", reason, killed, skipped, risksBefore: before.risks.map((risk) => risk.code), risksAfter: after.risks.map((risk) => risk.code) });
  return { ok: true, reason, killed, skipped, before, after };
}
