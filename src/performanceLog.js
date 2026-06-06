import { appendText, botDataPath, readText, writeText } from "./storage.js";

const fileName = "ollama-performance.jsonl";

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

function nsToSeconds(value) {
  const number = Number(value || 0);
  return number > 0 ? number / 1_000_000_000 : 0;
}

export function logModelPerformance(event) {
  const item = {
    ts: new Date().toISOString(),
    type: event.type || "chat",
    model: event.model || "",
    options: event.options || {},
    promptChars: event.promptChars || 0,
    messageCount: event.messageCount || 0,
    wallSeconds: round(event.wallSeconds),
    vramFreeBeforeMb: event.vramFreeBeforeMb ?? null,
    vramFreeAfterMb: event.vramFreeAfterMb ?? null,
    promptEvalCount: event.promptEvalCount ?? null,
    promptEvalSeconds: round(nsToSeconds(event.promptEvalDurationNs)),
    promptTokensPerSecond: event.promptEvalCount && event.promptEvalDurationNs
      ? round(event.promptEvalCount / nsToSeconds(event.promptEvalDurationNs))
      : null,
    evalCount: event.evalCount ?? null,
    evalSeconds: round(nsToSeconds(event.evalDurationNs)),
    outputTokensPerSecond: event.evalCount && event.evalDurationNs
      ? round(event.evalCount / nsToSeconds(event.evalDurationNs))
      : null,
    responseChars: event.responseChars ?? null,
    doneReason: event.doneReason || "",
    fallback: event.fallback || "",
    error: event.error || "",
  };

  appendText(fileName, `${JSON.stringify(item)}\n`);
}

export function readPerformanceLog(limit = 80) {
  const lines = readText(fileName, "").split(/\r?\n/).filter(Boolean);
  return lines.slice(-Math.max(1, Math.min(Number.parseInt(limit, 10) || 80, 500)));
}

export function clearPerformanceLog() {
  writeText(fileName, "");
}

export function getPerformanceLogPath() {
  return botDataPath(fileName);
}
