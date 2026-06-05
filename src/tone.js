import { readJson, writeJson, botDataPath } from "./storage.js";

const fileName = "tone.json";
const defaultTone = { level: 1 };

export const toneLevels = {
  0: "normal friend: calm, playful, no sharp roasting",
  1: "light roast: witty, gentle teasing, no personal attacks",
  2: "sharp but bounded: more sarcasm, still friendly and useful",
  3: "strong but no personal attacks: high spice, never cruel or demeaning",
};

export function getTone() {
  const data = readJson(fileName, defaultTone);
  const level = Number.parseInt(data.level, 10);
  return Number.isInteger(level) && level >= 0 && level <= 3 ? level : defaultTone.level;
}

export function setTone(level) {
  const parsed = Number.parseInt(level, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 3) {
    throw new Error("Tone level must be 0, 1, 2, or 3.");
  }
  writeJson(fileName, { level: parsed, updatedAt: new Date().toISOString() });
  return parsed;
}

export function getToneDescription(level = getTone()) {
  return toneLevels[level] || toneLevels[1];
}

export function getTonePath() {
  return botDataPath(fileName);
}