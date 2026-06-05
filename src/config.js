import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env");

dotenv.config({ path: envPath });

function readBoolean(name, fallback) {
  const value = process.env[name];
  if (value == null || value.trim() === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function readInteger(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function readFloat(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, min), max);
}

function readOptionalInteger(name, min, max) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.min(Math.max(parsed, min), max);
}
function readList(name) {
  const raw = process.env[name];
  if (!raw) {
    return new Set();
  }

  return new Set(
    raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function requireInsideProject(name, value) {
  if (!value) {
    return;
  }

  const resolved = path.resolve(value);
  const relative = path.relative(projectRoot, resolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${name} must stay inside ${projectRoot}: ${value}`);
  }
}

const ollamaModels = process.env.OLLAMA_MODELS || path.join(projectRoot, "runtime", "ollama", "models");
requireInsideProject("OLLAMA_MODELS", ollamaModels);

export const config = {
  projectRoot,
  discordToken: process.env.DISCORD_TOKEN || "",
  discordClientId: process.env.DISCORD_CLIENT_ID || "",
  discordGuildId: process.env.DISCORD_GUILD_ID || "",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434",
  ollamaModel: process.env.OLLAMA_MODEL || "qwen3.5:4b",
  ollamaModels,
  ollamaNumGpu: readOptionalInteger("OLLAMA_NUM_GPU", 0, 999),
  ollamaNumCtx: readInteger("OLLAMA_NUM_CTX", 1024, 512, 8192),
  ollamaNumPredict: readInteger("OLLAMA_NUM_PREDICT", 256, 64, 1024),
  ollamaTemperature: readFloat("OLLAMA_TEMPERATURE", 0.9, 0, 2),
  ollamaTopP: readFloat("OLLAMA_TOP_P", 0.9, 0.05, 1),
  ollamaRepeatPenalty: readFloat("OLLAMA_REPEAT_PENALTY", 1.08, 0.8, 2),
  ollamaKeepAlive: process.env.OLLAMA_KEEP_ALIVE || "2m",
  ollamaCpuFallback: readBoolean("OLLAMA_CPU_FALLBACK", false),
  ollamaRequireGpu: readBoolean("OLLAMA_REQUIRE_GPU", true),
  ollamaMinFreeVramMb: readInteger("OLLAMA_MIN_FREE_VRAM_MB", 1800, 256, 65536),
  allowedUserIds: readList("BOT_ALLOWED_USER_IDS"),
  allowedChannelIds: readList("BOT_ALLOWED_CHANNEL_IDS"),
  triggerPrefixes: Array.from(readList("BOT_TRIGGER_PREFIXES")).length > 0
    ? Array.from(readList("BOT_TRIGGER_PREFIXES"))
    : ["qwen", "qwen3", "tana", "tanaai", "ai"],
  allowWebSearch: readBoolean("BOT_ALLOW_WEB_SEARCH", false),
  searchPrefix: process.env.BOT_SEARCH_PREFIX || "search",
  searchMaxResults: readInteger("BOT_SEARCH_MAX_RESULTS", 4, 1, 8),
  requireMention: readBoolean("BOT_REQUIRE_MENTION", true),
  replyToBotReplies: readBoolean("BOT_REPLY_TO_BOT_REPLIES", true),
  maxInputChars: readInteger("BOT_MAX_INPUT_CHARS", 1800, 200, 6000),
  maxReplyChars: readInteger("BOT_MAX_REPLY_CHARS", 1800, 200, 1900),
  requestTimeoutMs: readInteger("BOT_REQUEST_TIMEOUT_MS", 90000, 5000, 180000),
  cooldownMs: readInteger("BOT_COOLDOWN_MS", 3000, 0, 60000),
};

export function validateConfig() {
  const missing = [];

  if (!config.discordToken) {
    missing.push("DISCORD_TOKEN");
  }

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}
export function buildOllamaOptions(numPredict = config.ollamaNumPredict, overrides = {}) {
  const options = {
    num_predict: numPredict,
    num_ctx: config.ollamaNumCtx,
    temperature: config.ollamaTemperature,
    top_p: config.ollamaTopP,
    repeat_penalty: config.ollamaRepeatPenalty,
  };
  if (config.ollamaNumGpu !== null) {
    options.num_gpu = config.ollamaNumGpu;
  }
  return { ...options, ...overrides };
}
