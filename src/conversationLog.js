import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

const logRoot = path.join(config.projectRoot, "runtime", "dashboard", "logs");
const conversationLog = path.join(logRoot, "conversation.jsonl");

function ensureLogRoot() {
  fs.mkdirSync(logRoot, { recursive: true });
}

function maskSecrets(value) {
  let text = String(value || "");
  if (config.discordToken) text = text.replaceAll(config.discordToken, "[DISCORD_TOKEN_REDACTED]");
  return text.replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/g, "[TOKEN_REDACTED]");
}

function clip(value, max = 1800) {
  const text = maskSecrets(value).replace(/\r/g, "");
  return text.length > max ? `${text.slice(0, max)}...[trimmed]` : text;
}

export function getConversationLogPath() {
  ensureLogRoot();
  return conversationLog;
}

export function logConversationEvent(event) {
  ensureLogRoot();
  const safe = {
    ts: new Date().toISOString(),
    type: event.type || "event",
    source: event.source || "discord",
    channelId: event.channelId || "",
    userId: event.userId || "",
    displayName: clip(event.displayName || "", 120),
    input: clip(event.input || ""),
    reply: clip(event.reply || ""),
    error: clip(event.error || ""),
    searched: Boolean(event.searched),
    memoryItems: Array.isArray(event.memoryItems) ? event.memoryItems.map((item) => ({
      field: clip(item.field || "", 80),
      value: clip(item.value || "", 240),
      confidence: clip(item.confidence || "", 40),
    })) : [],
    meta: event.meta && typeof event.meta === "object" ? event.meta : {},
  };
  fs.appendFileSync(conversationLog, `${JSON.stringify(safe)}\n`, "utf8");
}

export function readConversationLog(limit = 120) {
  ensureLogRoot();
  if (!fs.existsSync(conversationLog)) return [];
  const lines = fs.readFileSync(conversationLog, "utf8").split(/\r?\n/).filter(Boolean).slice(-Math.max(1, Math.min(limit, 500)));
  return lines.map((line) => {
    try { return JSON.parse(line); }
    catch { return { ts: "", type: "parse-error", error: clip(line) }; }
  });
}

export function clearConversationLog() {
  ensureLogRoot();
  fs.writeFileSync(conversationLog, "", "utf8");
}
