import { config } from "./config.js";
import { chatOllama } from "./ollamaApi.js";
import { botDataPath, readJson, writeJson } from "./storage.js";
import { formatSearchContext, webSearch } from "./webSearch.js";
import { getConversationShape, previewMemoryItems, recordMemoryItems } from "./promptMemory.js";

const autonomyFile = "autonomy.json";

const defaultAutonomySettings = {
  decisionMode: "model",
  searchMode: "aggressive",
  memoryMode: "high_confidence",
  decisionScope: "addressed_turns",
  searchDisclosure: "natural",
  memoryFeedback: "dashboard",
  searchConfidence: 0.65,
  memorySaveConfidence: 0.86,
  memoryCandidateConfidence: 0.55,
};

const searchPatterns = [
  { category: "direct_lookup", confidence: 0.95, re: /查一下|幫我查|找一下|搜一下|搜尋一下|google\s*一下|Google\s*一下|看一下網路|幫我確認|查查看|查查看看/u },
  { category: "freshness", confidence: 0.78, re: /最新|今天|現在|目前|最近|剛剛|有沒有更新|是不是改了|現在還是嗎|現在還能|還能用嗎|還適合嗎/u },
  { category: "verification", confidence: 0.82, re: /真的假的|有來源嗎|來源勒|哪裡看到|幫我驗證|幫我查證|是不是謠言|闢謠|可信嗎/u },
  { category: "recommendation", confidence: 0.72, re: /哪個比較好|推薦哪個|推薦.*嗎|值得買嗎|評價怎樣|排行|排名|CP\s*值|適合.*嗎|哪個模型|哪款|怎麼選/u },
  { category: "price_market", confidence: 0.82, re: /多少錢|價格|行情|特價|漲了嗎|跌了嗎|哪裡買|便宜|預購|上市/u },
  { category: "tech_current", confidence: 0.76, re: /最新版|release|patch|更新日誌|changelog|API.*改|文件|docs|documentation|錯誤碼|error code|套件版本/u },
  { category: "news_event", confidence: 0.8, re: /新聞|公告|發生什麼事|怎麼回事|有人說|網路上說|推特上說|X 上說|reddit.*說/u },
  { category: "rules_policy", confidence: 0.78, re: /規定|法規|政策|條款|限制|現在能不能|是否合法|違法嗎|官方說法/u },
];

const noSearchPatterns = [
  /我現在好累|我現在好煩|我現在很累|我現在很煩/u,
  /真的假的(?:啦|喔|笑死|救命|欸)?$/u,
  /笑死|太地獄|救命/u,
];

const fieldAliases = {
  alias: "aliases",
  aliases: "aliases",
  name: "aliases",
  like: "likes",
  likes: "likes",
  dislike: "dislikes",
  dislikes: "dislikes",
  project: "projects",
  projects: "projects",
  note: "notes",
  notes: "notes",
};

function clampNumber(value, fallback, min, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeMode(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function sanitizeSettings(input = {}) {
  return {
    decisionMode: normalizeMode(input.decisionMode, ["model", "hybrid", "rules"], defaultAutonomySettings.decisionMode),
    searchMode: normalizeMode(input.searchMode, ["manual", "conservative", "aggressive"], defaultAutonomySettings.searchMode),
    memoryMode: normalizeMode(input.memoryMode, ["manual", "candidate_only", "high_confidence"], defaultAutonomySettings.memoryMode),
    decisionScope: normalizeMode(input.decisionScope, ["addressed_turns"], defaultAutonomySettings.decisionScope),
    searchDisclosure: normalizeMode(input.searchDisclosure, ["natural", "always_sources", "dashboard_only"], defaultAutonomySettings.searchDisclosure),
    memoryFeedback: normalizeMode(input.memoryFeedback, ["dashboard", "light", "explicit"], defaultAutonomySettings.memoryFeedback),
    searchConfidence: clampNumber(input.searchConfidence, defaultAutonomySettings.searchConfidence, 0, 1),
    memorySaveConfidence: clampNumber(input.memorySaveConfidence, defaultAutonomySettings.memorySaveConfidence, 0, 1),
    memoryCandidateConfidence: clampNumber(input.memoryCandidateConfidence, defaultAutonomySettings.memoryCandidateConfidence, 0, 1),
  };
}

export function getAutonomySettings() {
  const data = readJson(autonomyFile, defaultAutonomySettings);
  const settings = sanitizeSettings({ ...defaultAutonomySettings, ...data });
  if (JSON.stringify(settings) !== JSON.stringify(data)) writeJson(autonomyFile, settings);
  return settings;
}

export function saveAutonomySettings(input) {
  const settings = sanitizeSettings({ ...getAutonomySettings(), ...input });
  writeJson(autonomyFile, settings);
  return settings;
}

export function getAutonomyPath() {
  getAutonomySettings();
  return botDataPath(autonomyFile);
}

function oneLine(value, max = 500) {
  const text = String(value || "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
}

function stripChatNoise(value) {
  return oneLine(value, 500)
    .replace(/<@!?\d+>/g, " ")
    .replace(/:[A-Za-z0-9_+-]+:/g, " ")
    .replace(/[！？!?]{2,}/g, " ")
    .replace(/\b(search|搜尋)\b[:：\s]*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLookupPhrases(value) {
  return stripChatNoise(value)
    .replace(/^(欸|欸欸|那|所以|問一下|想問|可以)?\s*/u, "")
    .replace(/(幫我)?(查一下|查查看|查查看看|幫我查|找一下|搜一下|搜尋一下|google\s*一下|看一下網路|幫我確認|幫我驗證|幫我查證)/giu, " ")
    .replace(/(真的假的|有來源嗎|來源勒|哪裡看到的?|是不是謠言|可信嗎)/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function usefulQuery(message, replyContext = null) {
  const own = stripLookupPhrases(message);
  if (own.length >= 6) return own.slice(0, 220);
  const replied = stripLookupPhrases(replyContext?.content || "");
  if (replied.length >= 6) return replied.slice(0, 220);
  return own.slice(0, 220);
}

function hasSearchSubject(message, replyContext = null) {
  return usefulQuery(message, replyContext).length >= 6;
}

function ruleSearchDecision(message, replyContext = null, forceSearch = false) {
  const text = oneLine(message, 800);
  if (forceSearch) {
    return {
      action: "search",
      query: usefulQuery(text, replyContext) || stripChatNoise(text),
      confidence: 1,
      triggerCategory: "forced",
      matchedPhrases: ["forced"],
      reason: "使用者明確要求搜尋。",
    };
  }

  if (!text || noSearchPatterns.some((pattern) => pattern.test(text))) {
    return { action: "skip", query: "", confidence: 0, triggerCategory: "none", matchedPhrases: [], reason: "看起來是聊天、玩笑或情緒，不需要搜尋。" };
  }

  for (const pattern of searchPatterns) {
    const match = text.match(pattern.re);
    if (match && hasSearchSubject(text, replyContext)) {
      return {
        action: "search",
        query: usefulQuery(text, replyContext),
        confidence: pattern.confidence,
        triggerCategory: pattern.category,
        matchedPhrases: [match[0]],
        reason: `命中口語搜尋觸發：${pattern.category}`,
      };
    }
  }

  return { action: "skip", query: "", confidence: 0.15, triggerCategory: "none", matchedPhrases: [], reason: "沒有明確外部查詢需求。" };
}

function ruleMemoryItems(message) {
  return previewMemoryItems(message).map((item) => ({
    action: item.confidence === "high" ? "save" : "candidate",
    field: item.field,
    value: item.value,
    confidence: item.confidence === "high" ? 0.95 : 0.62,
    reason: "命中既有記憶規則。",
  }));
}

function isLowSignalChat(message, channelContext = {}) {
  const text = oneLine(message, 300);
  if (!text) return true;
  if (getConversationShape(text, { channelContext }).type === "banter") return true;
  return /^(哈+|笑死|好喔|好欸|好哦|可以|沒問題|ok|嗯+|喔+|是喔|ww+|www+|草)$/iu.test(text.replace(/\s+/g, ""));
}

function extractJson(text) {
  const raw = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try { return JSON.parse(raw.slice(start, end + 1)); } catch {}
    }
  }
  return null;
}

function normalizeSearch(modelSearch, ruleSearch, settings, forceSearch) {
  if (!config.allowWebSearch && !forceSearch) {
    return { ...ruleSearch, action: "skip", confidence: 0, reason: "BOT_ALLOW_WEB_SEARCH is disabled." };
  }
  if (settings.searchMode === "manual" && !forceSearch) {
    return { ...ruleSearch, action: "skip", confidence: 0, reason: "Autonomy search mode is manual." };
  }
  if (forceSearch || ruleSearch.action === "search") return ruleSearch;

  const wantsSearch = Boolean(modelSearch?.action === "search" || modelSearch?.shouldSearch);
  const confidence = clampNumber(modelSearch?.confidence, 0, 0, 1);
  const threshold = settings.searchMode === "conservative" ? Math.max(settings.searchConfidence, 0.8) : settings.searchConfidence;
  if (wantsSearch && confidence >= threshold) {
    const query = oneLine(modelSearch.query || modelSearch.searchQuery || ruleSearch.query || "");
    return {
      action: "search",
      query: query || usefulQuery(modelSearch.sourceText || ""),
      confidence,
      triggerCategory: oneLine(modelSearch.triggerCategory || "model", 80),
      matchedPhrases: Array.isArray(modelSearch.matchedPhrases) ? modelSearch.matchedPhrases.map((item) => oneLine(item, 80)).filter(Boolean).slice(0, 6) : [],
      reason: oneLine(modelSearch.reason || "模型判斷需要外部資料。", 300),
    };
  }

  return {
    ...ruleSearch,
    action: "skip",
    confidence: Math.max(ruleSearch.confidence || 0, confidence),
    reason: oneLine(modelSearch?.reason || ruleSearch.reason || "模型判斷不需要搜尋。", 300),
  };
}

function isTransientOrJokeMemory(item, sourceText) {
  const combined = `${item?.value || ""}\n${sourceText || ""}`;
  if (/記住|我叫|叫我|我的名字|我(?:很|超|最)?喜歡|我(?:很|超|最)?(?:討厭|不喜歡)|我(?:正在|在)?(?:做|開發|玩|研究)/u.test(sourceText || "")) return false;
  return /現在好累|現在好煩|現在很累|現在很煩|等等|等一下|剛剛|今天心情|心情不好|笑死|真的假的笑死|救命|太地獄/u.test(combined);
}

function isExplicitAliasSource(sourceText) {
  return /(?:我叫|叫我|我的名字是|我的暱稱是|你可以叫我|以後叫我|之後叫我)/u.test(String(sourceText || ""));
}

function isBotDirectedMemorySource(sourceText) {
  const compact = String(sourceText || "").replace(/\s+/g, "");
  return /^你(?:會|能|可以|到底|只是|是誰|叫什麼|是真人|是什麼|是AI|是ai|是bot|是機器人)/u.test(compact)
    || /^(?:在)?測試(?:你|一下|啊|喔|而已)?$/u.test(compact)
    || /^(?:test|testing)$/iu.test(compact);
}

function normalizeMemoryItem(item, settings, sourceText = "") {
  const field = fieldAliases[String(item?.field || "").trim()] || "";
  const value = oneLine(item?.value || "", 220);
  const confidence = clampNumber(item?.confidence, 0, 0, 1);
  if (!field || !value) return null;
  if (isBotDirectedMemorySource(sourceText)) return null;
  if (isTransientOrJokeMemory(item, sourceText)) return null;
  if (field === "aliases" && !isExplicitAliasSource(sourceText)) return null;
  if (settings.memoryMode === "manual") return null;
  let action = String(item?.action || "").trim();
  if (!["save", "candidate", "skip"].includes(action)) {
    action = confidence >= settings.memorySaveConfidence ? "save" : confidence >= settings.memoryCandidateConfidence ? "candidate" : "skip";
  }
  if (settings.memoryMode === "candidate_only" && action === "save") action = "candidate";
  if (confidence < settings.memoryCandidateConfidence) action = "skip";
  return {
    action,
    field,
    value,
    confidence,
    reason: oneLine(item?.reason || "模型判斷這可能是長期偏好或使用者資料。", 240),
  };
}

function mergeMemoryItems(modelItems, ruleItems, settings, sourceText = "") {
  const merged = [];
  const seen = new Set();
  for (const item of [...ruleItems, ...(Array.isArray(modelItems) ? modelItems : [])]) {
    const normalized = normalizeMemoryItem(item, settings, sourceText);
    if (!normalized) continue;
    const key = `${normalized.action}:${normalized.field}:${normalized.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }
  const specific = merged.filter((item) => ["likes", "dislikes", "projects", "aliases"].includes(item.field));
  return merged.filter((item) => {
    if (item.field !== "notes") return true;
    return !specific.some((other) => item.value.includes(other.value) || other.value.includes(item.value));
  }).slice(0, 6);
}

function decisionPrompt(payload) {
  return [
    "你是 TinyDcBot 的內部決策器，只能輸出 JSON，不要輸出解釋、Markdown 或多餘文字。",
    "任務：判斷這則 Discord 對話是否需要網路搜尋，以及是否有值得長期記憶的資訊。",
    "搜尋偏積極：最新、目前、今天、價格、版本、新聞、推薦、真偽查證、文件、政策、可能過期的事實，都可搜尋。",
    "不要搜尋：單純聊天、玩笑、情緒抱怨、使用者只要你看已提供內容、個人偏好問題。",
    "記憶只限使用者自己的長期資訊：名字、稱呼、偏好、討厭、專案、穩定備註。",
    "不要記敏感資訊：電話、地址、token、密碼、金流、醫療、政治宗教性向、第三方隱私、臨時情緒、玩笑。",
    "輸出格式：",
    "{\"search\":{\"action\":\"search|skip\",\"query\":\"\",\"confidence\":0,\"triggerCategory\":\"\",\"matchedPhrases\":[],\"reason\":\"\"},\"memoryItems\":[{\"action\":\"save|candidate|skip\",\"field\":\"aliases|likes|dislikes|projects|notes\",\"value\":\"\",\"confidence\":0,\"reason\":\"\"}]}",
    "",
    JSON.stringify(payload),
  ].join("\n");
}

async function modelDecision(payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.requestTimeoutMs, 25000));
  try {
    const data = await chatOllama({
      signal: controller.signal,
      think: false,
      numPredict: 192,
      logType: "decision",
      optionOverrides: { temperature: 0.1, top_p: 0.35, repeat_penalty: 1.02 },
      messages: [{ role: "user", content: decisionPrompt(payload) }],
    });
    const parsed = extractJson(data?.message?.content || "");
    if (!parsed) throw new Error("Decision JSON parse failed.");
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

export async function decideTurn({ message, speaker = {}, replyContext = null, channelContext = {}, source = "discord", forceSearch = false, dryRun = false } = {}) {
  const settings = getAutonomySettings();
  const text = oneLine(message, 1000);
  const lowSignalChat = isLowSignalChat(text, channelContext);
  const ruleSearch = ruleSearchDecision(text, replyContext, forceSearch);
  const ruleItems = lowSignalChat ? [] : ruleMemoryItems(text);
  let model = null;
  let error = "";

  const shouldUseModel = !lowSignalChat && (settings.decisionMode === "model" || (settings.decisionMode === "hybrid" && !forceSearch));
  if (shouldUseModel && text) {
    try {
      model = await modelDecision({
        now: new Date().toISOString(),
        source,
        forceSearch,
        settings,
        speaker: { id: speaker.id || "", displayName: speaker.displayName || speaker.username || "" },
        message: text,
        replyContext: replyContext ? { displayName: replyContext.displayName || "", content: oneLine(replyContext.content || "", 600) } : null,
        channelSummary: oneLine(channelContext.summary || "", 400),
      });
    } catch (decisionError) {
      error = decisionError?.message || String(decisionError);
    }
  }

  const search = normalizeSearch(model?.search, ruleSearch, settings, forceSearch);
  const memoryItems = mergeMemoryItems(model?.memoryItems, ruleItems, settings, text);
  return {
    settings,
    source,
    dryRun: Boolean(dryRun),
    usedModel: Boolean(model),
    error,
    search,
    memoryItems,
  };
}

export function applyDecisionMemory(decision, speaker, sourceText) {
  if (!decision || decision.dryRun) return [];
  return recordMemoryItems(decision.memoryItems || [], speaker, sourceText);
}

export async function buildSearchAugmentedPrompt(originalMessage, decision) {
  const search = decision?.search || {};
  const clean = stripChatNoise(originalMessage);
  if (search.action !== "search") {
    return { prompt: clean, searched: false, searchQuery: "", searchResults: [], searchError: "" };
  }

  const query = oneLine(search.query || clean, 220);
  try {
    const results = await webSearch(query);
    const context = formatSearchContext(results);
    const disclosure = decision?.settings?.searchDisclosure || "natural";
    const sourceInstruction = disclosure === "always_sources"
      ? "請在回答最後列出你用到的 1 到 2 個來源網址。"
      : disclosure === "dashboard_only"
        ? "回答保持自然，不必特別說明搜尋過程。"
        : "如果搜尋結果有幫助，請自然提到查到的重點；必要時附 1 到 2 個來源。";
    const status = context || "【搜尋狀態】沒有找到可用搜尋結果。";
    return {
      prompt: `${status}\n\n【搜尋使用原則】\n${sourceInstruction}\n\n【使用者問題】\n${clean}`,
      searched: true,
      searchQuery: query,
      searchResults: results,
      searchError: "",
    };
  } catch (error) {
    return {
      prompt: `【搜尋狀態】網路搜尋失敗：${String(error?.message || error)}\n\n【使用者問題】\n${clean}`,
      searched: true,
      searchQuery: query,
      searchResults: [],
      searchError: error?.message || String(error),
    };
  }
}
