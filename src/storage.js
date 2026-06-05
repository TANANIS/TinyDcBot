import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export const botRuntimeRoot = path.join(config.projectRoot, "runtime", "bot");

export function ensureBotRuntime() {
  fs.mkdirSync(botRuntimeRoot, { recursive: true });
}

export function botDataPath(fileName) {
  ensureBotRuntime();
  const file = path.resolve(botRuntimeRoot, fileName);
  const relative = path.relative(botRuntimeRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Data file must stay inside ${botRuntimeRoot}: ${fileName}`);
  }
  return file;
}

export function readJson(fileName, fallback) {
  const file = botDataPath(fileName);
  if (!fs.existsSync(file)) {
    writeJson(fileName, fallback);
    return structuredClone(fallback);
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

export function writeJson(fileName, value) {
  const file = botDataPath(fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readText(fileName, fallback = "") {
  const file = botDataPath(fileName);
  if (!fs.existsSync(file)) {
    writeText(fileName, fallback);
    return fallback;
  }
  return fs.readFileSync(file, "utf8");
}

export function writeText(fileName, value) {
  const file = botDataPath(fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(value), "utf8");
}

export function appendText(fileName, value) {
  const file = botDataPath(fileName);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, String(value), "utf8");
}