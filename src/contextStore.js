import { readJson, writeJson, botDataPath } from "./storage.js";

const fileName = "context-state.json";
const maxMessages = 8;
const fallback = { channels: {} };

function sanitize(value, max = 500) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function load() {
  const data = readJson(fileName, fallback);
  if (!data.channels || typeof data.channels !== "object") return { channels: {} };
  return data;
}

function save(data) {
  writeJson(fileName, data);
}

function channelRecord(data, channelId) {
  const id = sanitize(channelId, 80) || "unknown";
  if (!data.channels[id]) data.channels[id] = { summary: "", messages: [], updatedAt: "" };
  if (!Array.isArray(data.channels[id].messages)) data.channels[id].messages = [];
  return data.channels[id];
}

export function recordChannelMessage(message) {
  const content = sanitize(message.content, 1000);
  if (!content) return;
  const data = load();
  const record = channelRecord(data, message.channelId);
  record.messages.push({
    id: sanitize(message.id, 80),
    authorId: sanitize(message.authorId, 80),
    displayName: sanitize(message.displayName, 120),
    username: sanitize(message.username, 120),
    content,
    createdAt: message.createdAt || new Date().toISOString(),
  });
  record.messages = record.messages.slice(-maxMessages);
  record.updatedAt = new Date().toISOString();
  save(data);
}

export function getChannelContext(channelId) {
  const data = load();
  const record = channelRecord(data, channelId);
  return structuredClone(record);
}

export function findChannelMessage(channelId, messageId) {
  const id = sanitize(messageId, 80);
  if (!id) return null;
  const record = getChannelContext(channelId);
  return record.messages.find((message) => message.id === id) || null;
}

export function resetChannelContext(channelId) {
  const data = load();
  data.channels[sanitize(channelId, 80) || "unknown"] = { summary: "", messages: [], updatedAt: new Date().toISOString() };
  save(data);
}

export function setChannelSummary(channelId, summary) {
  const data = load();
  const record = channelRecord(data, channelId);
  record.summary = sanitize(summary, 1400);
  record.updatedAt = new Date().toISOString();
  save(data);
}

export function listContext() {
  return load();
}

export function getContextPath() {
  return botDataPath(fileName);
}

export function formatRecentMessages(channelContext) {
  const messages = channelContext?.messages || [];
  if (messages.length === 0) return "目前沒有最近頻道訊息。";
  return messages.map((item) => `${item.displayName || item.username || item.authorId}: ${item.content}`).join("\n");
}
