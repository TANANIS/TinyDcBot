import { readJson, writeJson, botDataPath } from "./storage.js";

const fileName = "reminders.json";
const fallback = { reminders: [] };

function sanitize(value, max = 500) {
  return String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function load() {
  const data = readJson(fileName, fallback);
  return { reminders: Array.isArray(data.reminders) ? data.reminders : [] };
}

function save(data) {
  writeJson(fileName, data);
}

export function parseReminderTime(input, now = new Date()) {
  const raw = sanitize(input, 120);
  if (!raw) throw new Error("Reminder time is required.");

  const direct = new Date(raw);
  if (!Number.isNaN(direct.getTime())) return direct;

  const hhmm = raw.match(/^(today|tomorrow|明天|今天)?\s*(\d{1,2}):(\d{2})$/i);
  if (hhmm) {
    const date = new Date(now);
    if (["tomorrow", "明天"].includes((hhmm[1] || "").toLowerCase())) date.setDate(date.getDate() + 1);
    date.setHours(Number(hhmm[2]), Number(hhmm[3]), 0, 0);
    if (date <= now && !hhmm[1]) date.setDate(date.getDate() + 1);
    return date;
  }

  const relative = raw.match(/^(\d+)\s*(m|min|minute|minutes|分鐘|h|hr|hour|hours|小時)$/i);
  if (relative) {
    const count = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const ms = ["h", "hr", "hour", "hours", "小時"].includes(unit) ? count * 3600000 : count * 60000;
    return new Date(now.getTime() + ms);
  }

  throw new Error("Use ISO time, tomorrow HH:mm, today HH:mm, HH:mm, 10m, or 2h.");
}

export function addReminder({ userId, channelId, text, dueAt }) {
  const due = dueAt instanceof Date ? dueAt : parseReminderTime(dueAt);
  if (due <= new Date()) throw new Error("Reminder time must be in the future.");
  const data = load();
  const item = {
    id: `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: sanitize(userId, 80),
    channelId: sanitize(channelId, 80),
    text: sanitize(text, 500),
    dueAt: due.toISOString(),
    done: false,
    delivered: false,
    createdAt: new Date().toISOString(),
  };
  if (!item.text) throw new Error("Reminder text cannot be empty.");
  data.reminders.push(item);
  save(data);
  return item;
}

export function listReminders(filter = {}) {
  const data = load();
  return data.reminders.filter((item) => {
    if (filter.userId && item.userId !== filter.userId) return false;
    if (filter.activeOnly && (item.done || item.delivered)) return false;
    return true;
  });
}

export function completeReminder(id) {
  const data = load();
  const item = data.reminders.find((r) => r.id === id);
  if (!item) throw new Error("Reminder not found.");
  item.done = true;
  item.completedAt = new Date().toISOString();
  save(data);
  return item;
}

export function clearReminders(userId = "") {
  const data = load();
  if (userId) data.reminders = data.reminders.filter((item) => item.userId !== userId);
  else data.reminders = [];
  save(data);
}

export function dueReminders(now = new Date()) {
  const data = load();
  const due = [];
  for (const item of data.reminders) {
    if (!item.done && !item.delivered && new Date(item.dueAt) <= now) {
      item.delivered = true;
      item.deliveredAt = now.toISOString();
      due.push(item);
    }
  }
  if (due.length) save(data);
  return due;
}

export function formatReminder(item) {
  return `${item.id} | ${new Date(item.dueAt).toLocaleString("zh-TW", { hour12: false })} | ${item.text}`;
}

export function detectReminderCandidate(text) {
  const raw = sanitize(text, 500);
  const match = raw.match(/(?:提醒我|記得提醒我)\s*(.+)/);
  if (!match) return null;
  return { text: match[1], hint: "請用 /remind add text time 建立正式提醒，例如 /remind add 喝水 tomorrow 09:00。" };
}

export function getRemindersPath() {
  return botDataPath(fileName);
}