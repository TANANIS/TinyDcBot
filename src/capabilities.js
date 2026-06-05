import { readJson, writeJson, botDataPath } from "./storage.js";

const fileName = "capabilities.json";

const defaultCapabilities = {
  updatedAt: "2026-06-04",
  textTriggers: ["qwen", "qwen3", "tana", "tanaai", "ai"],
  slashCommands: [
    { command: "/help", description: "列出可用功能。" },
    { command: "/capabilities", description: "說明目前 bot 能做什麼。" },
    { command: "/context", description: "用本機 qwen3.5:4b 回答，可選網路搜尋。" },
    { command: "/search", description: "先搜尋再回答。" },
    { command: "/weather", description: "免 API key 查天氣。" },
    { command: "/profile", description: "管理目前使用者的個人記憶。" },
    { command: "/memory", description: "管理手動長期記憶與候選記憶。" },
    { command: "/tone", description: "查看或調整吐槽火力。" },
    { command: "/remind", description: "新增、查看、完成、清除本地提醒。" },
    { command: "/status", description: "查看模型、搜尋與摘要狀態。" },
    { command: "/model", description: "查看目前本機模型。" },
    { command: "/reset", description: "清除目前頻道上下文摘要。" }
  ],
  features: [
    "本機 Ollama qwen3.5:4b 回覆",
    "Discord 說話者辨識",
    "每頻道最近 8 則上下文",
    "reply 原訊息 context",
    "結構化使用者記憶",
    "候選記憶審核",
    "語氣強度控制",
    "DuckDuckGo HTML 搜尋",
    "wttr.in 天氣",
    "本地提醒事項",
    "Dashboard 狀態、記憶、提醒、log 與維護控制"
  ]
};

export function getCapabilities() {
  const data = readJson(fileName, defaultCapabilities);
  if (!Array.isArray(data.slashCommands) || !Array.isArray(data.features)) {
    writeJson(fileName, defaultCapabilities);
    return defaultCapabilities;
  }
  return data;
}

export function capabilitiesText() {
  const data = getCapabilities();
  return [
    "我現在會這些，別叫我現場通靈不存在的功能：",
    "",
    "指令：",
    ...data.slashCommands.map((item) => `- ${item.command}: ${item.description}`),
    "",
    "功能：",
    ...data.features.map((item) => `- ${item}`),
    "",
    `文字觸發詞：${data.textTriggers.join(", ")}`
  ].join("\n");
}

export function getCapabilitiesPath() {
  getCapabilities();
  return botDataPath(fileName);
}
export function isCapabilitiesQuestion(message) {
  const text = String(message || "").trim().toLowerCase();
  if (!text) return false;
  return [
    "你會什麼",
    "你能做什麼",
    "你有什麼功能",
    "你有什麼指令",
    "你會哪些指令",
    "help",
    "capabilities",
    "commands",
  ].some((keyword) => text.includes(keyword));
}