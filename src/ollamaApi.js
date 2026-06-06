import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildOllamaOptions, config } from "./config.js";
import { logModelPerformance } from "./performanceLog.js";
import { assertRuntimeSafe } from "./runtimeGuard.js";

const execFileAsync = promisify(execFile);

export function isOllamaResourceError(text) {
  return /CUDA error: out of memory|cudaMalloc failed|out[ -]of[ -]memory|failed to allocate|unable to allocate|kv cache/i.test(String(text || ""));
}

function isCudaOutOfMemory(text) {
  return /CUDA error: out of memory|cudaMalloc failed|out[ -]of[ -]memory/i.test(String(text || ""));
}

async function postChat(payload, signal) {
  const response = await fetch(new URL("/api/chat", config.ollamaBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  });

  const body = await response.text().catch(() => "");
  if (!response.ok) {
    const error = new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 300)}`);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return JSON.parse(body);
}


async function freeVramMb() {
  try {
    const { stdout } = await execFileAsync("nvidia-smi", ["--query-gpu=memory.free", "--format=csv,noheader,nounits"], { windowsHide: true, timeout: 2500 });
    const values = stdout.split(/\r?\n/).map((line) => Number.parseInt(line.trim(), 10)).filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  } catch {
    return null;
  }
}

async function assertGpuBudget() {
  if (!config.ollamaRequireGpu) return;
  if (config.ollamaNumGpu === 0) throw new Error("MODEL_GPU_REQUIRED");
  const free = await freeVramMb();
  if (free !== null && free < config.ollamaMinFreeVramMb) {
    const error = new Error("MODEL_GPU_BUSY");
    error.freeVramMb = free;
    error.minFreeVramMb = config.ollamaMinFreeVramMb;
    throw error;
  }
}
export async function chatOllama({ messages, numPredict = 512, signal, think = false, optionOverrides = {}, logType = "chat" }) {
  await assertRuntimeSafe(logType === "decision" ? "autonomy-preview" : "chat");
  await assertGpuBudget();
  const basePayload = {
    model: config.ollamaModel,
    stream: false,
    think,
    messages,
    options: buildOllamaOptions(numPredict, optionOverrides),
  };
  const started = performance.now();
  const promptChars = messages.reduce((sum, message) => sum + String(message?.content || "").length, 0);
  const vramFreeBeforeMb = await freeVramMb();

  try {
    const data = await postChat(basePayload, signal);
    logModelPerformance({
      type: logType,
      model: basePayload.model,
      options: basePayload.options,
      promptChars,
      messageCount: messages.length,
      wallSeconds: (performance.now() - started) / 1000,
      vramFreeBeforeMb,
      vramFreeAfterMb: await freeVramMb(),
      promptEvalCount: data.prompt_eval_count,
      promptEvalDurationNs: data.prompt_eval_duration,
      evalCount: data.eval_count,
      evalDurationNs: data.eval_duration,
      responseChars: String(data?.message?.content || "").length,
      doneReason: data.done_reason,
    });
    return data;
  } catch (error) {
    if (config.ollamaCpuFallback && config.ollamaNumGpu === null && isCudaOutOfMemory(`${error.body || ""}\n${error.message || ""}`)) {
      console.warn("Ollama CUDA OOM; CPU fallback is enabled, retrying once with num_gpu=0.");
      const fallbackPayload = { ...basePayload, options: buildOllamaOptions(numPredict, { ...optionOverrides, num_gpu: 0 }) };
      const data = await postChat(fallbackPayload, signal);
      logModelPerformance({
        type: logType,
        model: fallbackPayload.model,
        options: fallbackPayload.options,
        promptChars,
        messageCount: messages.length,
        wallSeconds: (performance.now() - started) / 1000,
        vramFreeBeforeMb,
        vramFreeAfterMb: await freeVramMb(),
        promptEvalCount: data.prompt_eval_count,
        promptEvalDurationNs: data.prompt_eval_duration,
        evalCount: data.eval_count,
        evalDurationNs: data.eval_duration,
        responseChars: String(data?.message?.content || "").length,
        doneReason: data.done_reason,
        fallback: "cpu",
      });
      return data;
    }
    logModelPerformance({
      type: "error",
      model: basePayload.model,
      options: basePayload.options,
      promptChars,
      messageCount: messages.length,
      wallSeconds: (performance.now() - started) / 1000,
      vramFreeBeforeMb,
      vramFreeAfterMb: await freeVramMb(),
      error: error?.message || String(error),
    });
    throw error;
  }
}
