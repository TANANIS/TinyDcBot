import { botDataPath, readJson, writeJson } from "./storage.js";

const fileName = "self-memory.json";
const maxEntryChars = 180;
const maxSourceChars = 360;
const maxEntriesPerSection = 24;
const validSections = ["principles", "voice", "avoid"];
const emptyMemory = {
  version: 1,
  updatedAt: "",
  principles: [],
  voice: [],
  avoid: [],
};

function cloneEmptyMemory() {
  return structuredClone(emptyMemory);
}

function clip(value, maxChars = maxEntryChars) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > maxChars ? text.slice(0, maxChars).trim() : text;
}

function normalize(value) {
  return clip(value, 220)
    .toLowerCase()
    .replace(/[「」『』"'`，。！？!?、：:；;,.()\[\]{}<>【】\s]/g, "");
}

function load() {
  const data = readJson(fileName, cloneEmptyMemory());
  let changed = false;
  if (!data || typeof data !== "object") return cloneEmptyMemory();
  data.version = 1;
  data.updatedAt = data.updatedAt || "";
  for (const section of validSections) {
    if (!Array.isArray(data[section])) {
      data[section] = [];
      changed = true;
    }
    data[section] = data[section]
      .map((item) => ({
        id: clip(item?.id, 80) || `sm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: clip(item?.text),
        source: clip(item?.source, 40) || "unknown",
        count: Math.max(1, Number.parseInt(item?.count, 10) || 1),
        confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0.7)),
        firstSeenAt: item?.firstSeenAt || new Date().toISOString(),
        lastSeenAt: item?.lastSeenAt || item?.firstSeenAt || new Date().toISOString(),
        sourceExcerpt: clip(item?.sourceExcerpt, maxSourceChars),
      }))
      .filter((item) => item.text)
      .slice(-maxEntriesPerSection);
  }
  if (changed) save(data);
  return data;
}

function save(data) {
  data.updatedAt = new Date().toISOString();
  writeJson(fileName, data);
}

function sentenceParts(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .split(/(?:\n+|[。！？!?]\s*)/u)
    .map((part) => clip(part, maxEntryChars))
    .filter(Boolean);
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function isSensitive(text) {
  return /token|api key|apikey|password|密碼|電話|手機|地址|住址|身分證|信用卡|銀行|醫療|診斷|病史|政治|宗教|性向|性別認同/i.test(text)
    || /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/.test(text)
    || /\b(?:sk-|ghp_|xoxb-)[A-Za-z0-9_-]{12,}/i.test(text);
}

function isPersonaWorkshop(input) {
  const compact = String(input || "").replace(/\s+/g, "");
  const asksForSelfDraft = hasAny(compact, [
    /聊聊你自己/u,
    /你(?:是誰|覺得你自己|的價值觀|的個性|的人設|的設定|想成為什麼)/u,
    /塑造(?:你|自己|人格|個性)/u,
    /自我介紹/u,
    /講(?:一下|講)?你的(?:想法|價值觀|個性)/u,
  ]);
  const explicitSave = hasAny(compact, [
    /(?:以後|之後|下次).{0,16}(?:保持|維持|記住|照這樣)/u,
    /(?:這樣|這種).{0,12}(?:很好|比較好|對|可以)/u,
    /記住/u,
  ]);
  return asksForSelfDraft && !explicitSave;
}

function cleanupCommandPhrase(text) {
  return clip(String(text || "")
    .replace(/^(?:你|妳|bot|機器人|TanaAI?|Tana)?\s*/iu, "")
    .replace(/^(?:以後|之後|下次|拜託|麻煩)?\s*/, "")
    .replace(/^(?:可以|要|應該|最好)?\s*/, ""), maxEntryChars);
}

function pushCandidate(items, section, text, source, confidence, sourceExcerpt) {
  const cleaned = cleanupCommandPhrase(text);
  if (!validSections.includes(section) || cleaned.length < 4) return;
  const combined = `${cleaned}\n${sourceExcerpt || ""}`;
  if (isSensitive(combined)) return;
  items.push({
    section,
    text: cleaned,
    source,
    confidence,
    sourceExcerpt: clip(sourceExcerpt, maxSourceChars),
  });
}

export function previewSelfMemoryFromTurn({ input = "", reply = "", source = "discord" } = {}) {
  const userText = clip(input, 1000);
  const botText = clip(reply, 1600);
  const compactUser = userText.replace(/\s+/g, "");
  const items = [];

  if (hasAny(compactUser, [/不知道就說不知道/u, /不確定就說不確定/u, /不要假裝知道/u, /不要硬裝/u])) {
    pushCandidate(items, "principles", "不知道就說不知道，不確定就說不確定，不要把空白資料補成事實。", "user-correction", 0.95, userText);
  }
  if (hasAny(compactUser, [/提到資料庫沒問題/u, /可以提(?:到)?(?:你的)?資料庫/u])) {
    pushCandidate(items, "principles", "可以提到記憶庫或資料庫，但要清楚區分確定知道、最近上下文、還有不知道。", "user-correction", 0.92, userText);
  }
  if (hasAny(compactUser, [/不要每次.*(?:同一套|固定|模板|重複)/u, /太(?:模板|制式|公式)/u, /重複相同邏輯/u])) {
    pushCandidate(items, "avoid", "避免每次都用固定套路或重複同一套推進邏輯。", "user-correction", 0.95, userText);
  }
  if (hasAny(compactUser, [/不要.*(?:要不要|選一個|直接丟主題|比較有效率)/u])) {
    pushCandidate(items, "avoid", "避免把所有閒聊都收斂成「要不要、選一個、直接丟主題、比較有效率」。", "user-correction", 0.9, userText);
  }
  if (hasAny(compactUser, [/(?:更像|接近)人/u, /比較有人味/u, /有個性/u])) {
    pushCandidate(items, "voice", "回覆要像真人接話：有反應、有取捨，不要只像任務分流器。", "user-correction", 0.88, userText);
  }
  if (hasAny(compactUser, [/可以(?:多講|講多一點|回多一點)/u, /有時候.*話.*太少/u])) {
    pushCandidate(items, "voice", "依情境決定篇幅；需要分析、規劃、解釋時可以多講，不要硬縮成一句。", "user-correction", 0.88, userText);
  }

  const correctionMatches = [
    { section: "avoid", re: /(?:以後|之後|下次)?[^，,。！？!?]{0,20}(?:不要|別|少一點|不要再|別再|不要一直|別一直)([^，,。！？!?]{4,120})/gu, prefix: "避免" },
    { section: "voice", re: /(?:以後|之後|下次)?[^，,。！？!?]{0,20}(?:保持|維持|照這樣|這樣回|這樣講)([^，,。！？!?]{0,120})/gu, prefix: "保持" },
  ];
  for (const rule of correctionMatches) {
    for (const match of userText.matchAll(rule.re)) {
      const value = `${rule.prefix}${match[1] || match[0]}`;
      pushCandidate(items, rule.section, value, "user-correction", 0.82, userText);
    }
  }

  if (!isPersonaWorkshop(userText)) {
    for (const sentence of sentenceParts(botText)) {
      const compactSentence = sentence.replace(/\s+/g, "");
      const selfStatement = hasAny(compactSentence, [
        /^我(?:會|不會|偏好|傾向|在意|不喜歡|比較|的原則是|的價值觀是)/u,
        /^我的(?:原則|價值觀|說話方式|風格)/u,
      ]);
      const valueStyle = hasAny(compactSentence, [
        /不知道|不確定|不裝懂|直接|實際|幫忙|吐槽|模板|重複|安全|簡短|長篇|人格|價值觀|效率/u,
      ]);
      if (!selfStatement || !valueStyle || sentence.length > 120) continue;
      const section = hasAny(compactSentence, [/不會|不喜歡|避免|不要|模板|重複/u]) ? "avoid" : hasAny(compactSentence, [/風格|說話|吐槽|簡短|長篇|直接/u]) ? "voice" : "principles";
      pushCandidate(items, section, sentence, source === "dashboard" ? "bot-dashboard" : "bot-reply", 0.74, botText);
    }
  }

  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.section}:${normalize(item.text)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findExisting(list, text) {
  const target = normalize(text);
  if (!target) return null;
  return list.find((item) => {
    const current = normalize(item.text);
    if (!current) return false;
    return current === target || (target.length > 10 && current.includes(target)) || (current.length > 10 && target.includes(current));
  }) || null;
}

export function learnSelfMemoryFromTurn(turn = {}) {
  const candidates = previewSelfMemoryFromTurn(turn);
  if (!candidates.length) return [];

  const data = load();
  const now = new Date().toISOString();
  const recorded = [];
  let changed = false;

  for (const candidate of candidates) {
    const list = data[candidate.section];
    const existing = findExisting(list, candidate.text);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.lastSeenAt = now;
      existing.confidence = Math.max(existing.confidence || 0, candidate.confidence);
      existing.sourceExcerpt = candidate.sourceExcerpt || existing.sourceExcerpt;
      recorded.push({ action: "updated", section: candidate.section, value: existing.text, confidence: existing.confidence });
    } else {
      const item = {
        id: `sm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        text: candidate.text,
        source: candidate.source,
        count: 1,
        confidence: candidate.confidence,
        firstSeenAt: now,
        lastSeenAt: now,
        sourceExcerpt: candidate.sourceExcerpt,
      };
      list.push(item);
      data[candidate.section] = list.slice(-maxEntriesPerSection);
      recorded.push({ action: "saved", section: candidate.section, value: item.text, confidence: item.confidence });
    }
    changed = true;
  }

  if (changed) save(data);
  return recorded;
}

export function getSelfMemory() {
  return load();
}

export function getSelfMemoryPath() {
  load();
  return botDataPath(fileName);
}

export function clearSelfMemory(section = "") {
  const data = load();
  if (section) {
    if (!validSections.includes(section)) throw new Error("Invalid self-memory section.");
    data[section] = [];
  } else {
    for (const key of validSections) data[key] = [];
  }
  save(data);
  return data;
}

export function formatSelfMemoryForPrompt() {
  const data = load();
  const blocks = [
    ["原則", data.principles],
    ["說話風格", data.voice],
    ["避免", data.avoid],
  ].map(([label, list]) => {
    const lines = list
      .slice(-8)
      .filter((item) => item.confidence >= 0.7)
      .map((item) => `- ${item.text}`);
    return lines.length ? `${label}：\n${lines.join("\n")}` : `${label}：目前沒有穩定記憶。`;
  });

  return [
    ...blocks,
    "規則：這些只代表長期對話風格與原則，不是人生履歷。臨時角色扮演或自我介紹草稿不能覆寫它們。",
  ].join("\n");
}
