import { capabilitiesText, getCapabilitiesPath } from "./capabilities.js";
import { botDataPath, readJson, writeJson } from "./storage.js";

const fileName = "bot-updates.json";

const defaultUpdates = {
  updatedAt: "2026-06-04",
  policy: "Bot may read this file and capabilities.json to understand its own current abilities. Bot must not edit code or update this file by itself.",
  updates: [
    {
      at: "2026-06-04",
      title: "Added context, structured memory, tone, capabilities, reminders, dashboard management, and conversation monitor.",
      capabilities: [
        "per-channel recent context",
        "per-user structured memory",
        "memory candidates",
        "tone control",
        "capabilities self-description",
        "local reminders",
        "dashboard memory/reminder/log controls",
        "read-only self knowledge",
        "conversation monitor log"
      ]
    }
  ]
};

export function getSelfUpdates() {
  const data = readJson(fileName, defaultUpdates);
  if (!Array.isArray(data.updates)) {
    writeJson(fileName, defaultUpdates);
    return defaultUpdates;
  }
  return data;
}

export function getSelfUpdatesPath() {
  getSelfUpdates();
  return botDataPath(fileName);
}

export function selfKnowledgeText() {
  const updates = getSelfUpdates();
  const recent = updates.updates.slice(-6).map((item) => {
    const caps = Array.isArray(item.capabilities) && item.capabilities.length ? `\n  - ${item.capabilities.join("\n  - ")}` : "";
    return `- ${item.at || "unknown"}: ${item.title || "update"}${caps}`;
  }).join("\n");
  return [
    "【自我知識讀取規則】",
    updates.policy,
    `Capabilities file: ${getCapabilitiesPath()}`,
    `Updates file: ${getSelfUpdatesPath()}`,
    "",
    "【目前能力摘要】",
    capabilitiesText(),
    "",
    "【最近更新】",
    recent || "目前沒有更新紀錄。"
  ].join("\n");
}
