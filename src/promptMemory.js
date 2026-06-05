import { appendText, botDataPath, readJson, readText, writeJson, writeText } from "./storage.js";
import { getTone, getToneDescription } from "./tone.js";
import { capabilitiesText } from "./capabilities.js";
import { selfKnowledgeText } from "./selfKnowledge.js";
import { formatRecentMessages } from "./contextStore.js";

const manualMemoryFile = "memories.txt";
const userMemoryFile = "auto-memories.json";
const candidatesFile = "memory-candidates.json";
const maxMessageChars = 4200;
const maxItemChars = 180;
const replyProfiles = {
  brief: {
    label: "brief",
    numPredict: 192,
    instruction: "短回覆：1 到 3 句，直接回答或接話，不要硬加背景說明。",
  },
  standard: {
    label: "standard",
    numPredict: 448,
    instruction: "一般回覆：3 到 6 句，先給結論，再補一點理由或下一步。",
  },
  detailed: {
    label: "detailed",
    numPredict: 768,
    instruction: "展開回覆：用短段落或清單回答，保留重點、理由、步驟、風險或取捨。",
  },
};

const defaultManualMemory = `你是一個 Discord 回應式聊天 bot。

【人格】
你是一個有趣、有反應、懂吐槽的網路朋友。
你可以厭世、可以嘴賤、可以陰陽怪氣，但核心是陪人聊天，不是把人打爛。
你要像有趣的靈魂，不是單純 hater。

【語氣】
- 使用繁體中文。
- 短句、口語、像 Discord 聊天。
- 可以吐槽情境、行為、荒謬感，但不要直接貶低使用者本人。
- 可以用輕度髒話，但不要靠髒話撐場。
- 不要像客服，不要像心理師，不要像公司主管。
- 不要過度正向，不要雞湯。

【邊界】
- 不要叫使用者閉嘴、滾、洗臉、少廢話。
- 不要說使用者沒人理、可悲、廢物、看不下去、腦子有問題。
- 不要攻擊人格、外貌、出身、疾病、性別、族群。
- 吐槽要像朋友互虧，不是網路霸凌。
- 當不確定對方是否能接受玩笑時，降低攻擊性。
`;

const emptyUsers = { users: {} };
const emptyCandidates = { candidates: [] };

function clip(value, maxChars) {
  const text = String(value || "").trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

function line(value, maxChars = maxItemChars) {
  return clip(String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " "), maxChars);
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

export function getReplyProfile(userMessage) {
  const text = String(userMessage || "").trim();
  const compact = text.replace(/\s+/g, "");
  const wantsBrief = hasAny(text, [
    /簡短|簡單說|一句話|快速回答|短答|tl;?dr/i,
    /不要太長|別太長|短一點/u,
  ]);
  const wantsDetailed = hasAny(text, [
    /詳細|完整|展開|多講|長一點|深入|仔細|好好說|慢慢說/u,
    /分析|解釋|說明|教學|步驟|規劃|策略|評估|比較|優缺點|風險|盲點|原因|架構/u,
    /怎麼做|怎麼修|怎麼改|為什麼|幫我看|幫我檢查|給我建議|整理一下/u,
  ]);

  if (wantsBrief && !wantsDetailed) return replyProfiles.brief;
  if (wantsDetailed || text.length > 180 || compact.length > 90) return replyProfiles.detailed;
  if (compact.length <= 24 && hasAny(text, [/^(嗨|hi|hello|哈囉|早|晚安|謝|ok|好|嗯|是|不是|可以|收到)/i])) return replyProfiles.brief;
  return replyProfiles.standard;
}

export function getReplyNumPredict(userMessage, fallback) {
  const profile = getReplyProfile(userMessage);
  const base = Number.isFinite(fallback) ? fallback : replyProfiles.standard.numPredict;
  if (profile.label === "brief") {
    return Math.min(Math.max(base, 128), profile.numPredict);
  }
  return Math.min(Math.max(base, profile.numPredict), 1024);
}

function replyPolicyForPrompt(profile) {
  return [
    `本次建議篇幅：${profile.label}`,
    profile.instruction,
    "判斷規則：打招呼、確認、單點小問題就短；聊天或普通建議用中等篇幅；分析、除錯、教學、比較、規劃、風險檢查要展開。",
    "如果使用者明確要求簡短，就優先簡短；如果明確要求詳細，就不要只丟一句話。",
    "保持 Discord 口語感：段落短、句子短，但不要把必要資訊省掉。",
    "如果使用者在討論 bot 行為或回覆品質，要從你自己的回覆策略說明，不要把責任推給使用者要換問法。",
  ].join("\n");
}

function normalizeSpeaker(speaker = {}) {
  return {
    id: line(speaker.id || "unknown", 80),
    username: line(speaker.username || "unknown", 120),
    displayName: line(speaker.displayName || speaker.username || "unknown", 120),
    channelId: line(speaker.channelId || "unknown", 80),
    guildId: line(speaker.guildId || "DM", 80),
  };
}

function ensureManualMemory() {
  const existing = readText(manualMemoryFile, defaultManualMemory);
  if (!existing.trim()) writeText(manualMemoryFile, defaultManualMemory);
}

function migrateUserRecord(id, record) {
  const migrated = {
    id,
    username: line(record?.username || id, 120),
    displayName: line(record?.displayName || record?.username || id, 120),
    aliases: Array.isArray(record?.aliases) ? record.aliases.map((item) => line(item)).filter(Boolean) : [],
    likes: Array.isArray(record?.likes) ? record.likes.map((item) => line(item)).filter(Boolean) : [],
    dislikes: Array.isArray(record?.dislikes) ? record.dislikes.map((item) => line(item)).filter(Boolean) : [],
    projects: Array.isArray(record?.projects) ? record.projects.map((item) => line(item)).filter(Boolean) : [],
    notes: Array.isArray(record?.notes) ? record.notes.map((item) => line(item)).filter(Boolean) : [],
    lastSeenAt: record?.lastSeenAt || record?.updatedAt || new Date().toISOString(),
  };

  if (Array.isArray(record?.memories)) {
    for (const item of record.memories) {
      const text = line(item);
      if (text && !migrated.notes.includes(text)) migrated.notes.push(text);
    }
  }

  return migrated;
}

function loadUsers() {
  const data = readJson(userMemoryFile, emptyUsers);
  if (!data.users || typeof data.users !== "object") return { users: {} };
  let changed = false;
  for (const [id, record] of Object.entries(data.users)) {
    const migrated = migrateUserRecord(id, record);
    if (JSON.stringify(migrated) !== JSON.stringify(record)) {
      data.users[id] = migrated;
      changed = true;
    }
  }
  if (changed) saveUsers(data);
  return data;
}

function saveUsers(data) {
  writeJson(userMemoryFile, data);
}

function loadCandidates() {
  const data = readJson(candidatesFile, emptyCandidates);
  if (!Array.isArray(data.candidates)) return { candidates: [] };
  return data;
}

function saveCandidates(data) {
  writeJson(candidatesFile, data);
}

function defaultUser(speaker) {
  return {
    id: speaker.id,
    username: speaker.username,
    displayName: speaker.displayName,
    aliases: [],
    likes: [],
    dislikes: [],
    projects: [],
    notes: [],
    lastSeenAt: new Date().toISOString(),
  };
}

function getUserRecord(data, speaker) {
  const key = speaker.id || "unknown";
  if (!data.users[key]) data.users[key] = defaultUser(speaker);
  const user = data.users[key];
  user.id = key;
  user.username = speaker.username;
  user.displayName = speaker.displayName;
  user.lastSeenAt = new Date().toISOString();
  for (const field of ["aliases", "likes", "dislikes", "projects", "notes"]) {
    if (!Array.isArray(user[field])) user[field] = [];
  }
  return user;
}

function addUnique(list, value) {
  const text = line(value);
  if (!text) return false;
  const normalized = text.toLowerCase();
  const withoutDupes = list.filter((item) => String(item).toLowerCase() !== normalized);
  withoutDupes.push(text);
  list.splice(0, list.length, ...withoutDupes.slice(-24));
  return true;
}

function candidate(kind, value, speaker, sourceText, confidence = "low") {
  const data = loadCandidates();
  const item = {
    id: `m_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: speaker.id,
    displayName: speaker.displayName,
    kind,
    value: line(value),
    sourceText: line(sourceText, 500),
    confidence,
    createdAt: new Date().toISOString(),
  };
  if (!item.value) return null;
  data.candidates.push(item);
  data.candidates = data.candidates.slice(-100);
  saveCandidates(data);
  return item;
}

export function previewMemoryItems(text) {
  const clean = line(text, 600);
  if (!clean) return [];
  const items = [];
  const patterns = [
    { field: "aliases", confidence: "high", re: /(?:我叫|叫我|我的名字是)\s*([^，。,.!！?？\s]{1,40})/u },
    { field: "likes", confidence: "high", re: /我(?:很|超|最)?喜歡\s*([^。！!？?]{1,100})/u },
    { field: "dislikes", confidence: "high", re: /我(?:很|超|最)?(?:討厭|不喜歡)\s*([^。！!？?]{1,100})/u },
    { field: "projects", confidence: "high", re: /我(?:正在|在)?(?:做|開發|玩|研究)\s*([^。！!？?]{1,100})/u },
    { field: "notes", confidence: "high", re: /記住[:：]?\s*([^。！!？?]{1,140})/u },
    { field: "notes", confidence: "low", re: /(?:之後|以後|下次).{0,20}(?:提醒|記得|不要忘記)\s*([^。！!？?]{1,140})/u },
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern.re);
    if (match?.[1]) items.push({ field: pattern.field, value: match[1], confidence: pattern.confidence });
  }
  return items;
}

export function updateAutoMemoryFromTurn(userMessage, speakerContext = {}) {
  const speaker = normalizeSpeaker(speakerContext);
  const users = loadUsers();
  const user = getUserRecord(users, speaker);
  let changed = false;

  for (const item of previewMemoryItems(userMessage)) {
    if (item.confidence === "high") {
      changed = addUnique(user[item.field], item.value) || changed;
    } else {
      candidate(item.field, item.value, speaker, userMessage, item.confidence);
    }
  }

  if (changed) saveUsers(users);
  return changed;
}

export function listMemories() {
  ensureManualMemory();
  return readText(manualMemoryFile, defaultManualMemory).trim() || "目前沒有手動長期記憶。";
}

export function addMemory(memory) {
  const text = line(memory, 1000);
  if (!text) throw new Error("Memory cannot be empty.");
  ensureManualMemory();
  appendText(manualMemoryFile, `\n- ${text}\n`);
}

export function clearMemories() {
  writeText(manualMemoryFile, "目前沒有手動長期記憶。\n");
}

export function getMemoryPath() {
  ensureManualMemory();
  return botDataPath(manualMemoryFile);
}

export function getAutoMemoryPath() {
  readJson(userMemoryFile, emptyUsers);
  return botDataPath(userMemoryFile);
}

export function getCandidatesPath() {
  readJson(candidatesFile, emptyCandidates);
  return botDataPath(candidatesFile);
}

export function getMemoryUsers() {
  return loadUsers();
}

export function saveMemoryUsers(users) {
  if (!users || typeof users !== "object" || !users.users) throw new Error("Invalid users payload.");
  saveUsers(users);
  return loadUsers();
}

export function addUserMemory(userId, field, value, speaker = {}) {
  if (!["aliases", "likes", "dislikes", "projects", "notes"].includes(field)) throw new Error("Invalid memory field.");
  const users = loadUsers();
  const normalized = normalizeSpeaker({ id: userId, username: speaker.username || userId, displayName: speaker.displayName || userId });
  const user = getUserRecord(users, normalized);
  addUnique(user[field], value);
  saveUsers(users);
  return user;
}

export function forgetUserMemory(userId, field = "", value = "") {
  const users = loadUsers();
  const user = users.users[userId];
  if (!user) return users;
  if (!field) delete users.users[userId];
  else if (Array.isArray(user[field])) user[field] = value ? user[field].filter((item) => item !== value) : [];
  saveUsers(users);
  return users;
}

export function clearAutoMemories(userId = "") {
  const users = loadUsers();
  if (userId) delete users.users[userId];
  else users.users = {};
  saveUsers(users);
}

export function listAutoMemories(userId = "") {
  const users = loadUsers();
  const records = userId ? [users.users[userId]].filter(Boolean) : Object.values(users.users);
  if (records.length === 0) return userId ? "目前沒有這位使用者的自動記憶。" : "目前沒有任何自動記憶。";
  return records.map(formatUserMemory).join("\n\n");
}

function formatUserMemory(user) {
  const sections = [
    [`別名`, user.aliases],
    [`喜歡`, user.likes],
    [`討厭`, user.dislikes],
    [`專案`, user.projects],
    [`備註`, user.notes],
  ].flatMap(([label, list]) => (list?.length ? [`${label}: ${list.join("、")}`] : []));
  return [`${user.displayName || user.username || user.id} (${user.id})`, ...sections, `lastSeenAt: ${user.lastSeenAt || "unknown"}`].join("\n");
}

export function getMemoryCandidates() {
  return loadCandidates();
}

export function approveMemoryCandidate(id) {
  const candidates = loadCandidates();
  const index = candidates.candidates.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Candidate not found.");
  const item = candidates.candidates.splice(index, 1)[0];
  addUserMemory(item.userId, item.kind, item.value, { displayName: item.displayName });
  saveCandidates(candidates);
  return item;
}

export function rejectMemoryCandidate(id) {
  const candidates = loadCandidates();
  const before = candidates.candidates.length;
  candidates.candidates = candidates.candidates.filter((item) => item.id !== id);
  if (candidates.candidates.length === before) throw new Error("Candidate not found.");
  saveCandidates(candidates);
}

export function clearMemoryCandidates() {
  saveCandidates({ candidates: [] });
}

export function formatSpeakerContext(speakerContext = {}) {
  const speaker = normalizeSpeaker(speakerContext);
  return [
    `Discord ID: ${speaker.id}`,
    `顯示名稱: ${speaker.displayName}`,
    `使用者名稱: ${speaker.username}`,
    `伺服器 ID: ${speaker.guildId}`,
    `頻道 ID: ${speaker.channelId}`,
  ].join("\n");
}

function formatUserMemoryForPrompt(speaker) {
  const users = loadUsers();
  const user = users.users[speaker.id];
  return user ? formatUserMemory(user) : "目前沒有這位使用者的結構化記憶。";
}

export function buildPrompt(userMessage, context = {}) {
  const speaker = normalizeSpeaker(context.speaker || context);
  const tone = getTone();
  const message = clip(userMessage, maxMessageChars);
  const replyProfile = getReplyProfile(context.rawUserMessage || userMessage);
  const channelContext = context.channelContext || {};
  const replyContext = context.replyContext ? `${context.replyContext.displayName || "unknown"}: ${context.replyContext.content}` : "目前不是回覆特定訊息。";

  return `你是一個 Discord 回應式聊天 bot。

【核心人格】
${listMemories()}

【語氣強度】
level ${tone}: ${getToneDescription(tone)}
規則：可以吐槽情境與荒謬感，但不要攻擊使用者本人。好笑不是等於惡毒。

【回覆篇幅判斷】
${replyPolicyForPrompt(replyProfile)}

【你目前可用功能】
${capabilitiesText()}

【目前說話者】
${formatSpeakerContext(speaker)}

【這位使用者的記憶】
${formatUserMemoryForPrompt(speaker)}

【被回覆的訊息】
${replyContext}

【最近頻道訊息】
${formatRecentMessages(channelContext)}

【頻道摘要】
${channelContext.summary || "目前沒有頻道摘要。"}

【目前訊息】
${message}

請用繁體中文，不要混用簡體字，像 Discord 朋友聊天一樣回覆。`;
}
