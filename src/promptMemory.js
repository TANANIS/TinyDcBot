import { appendText, botDataPath, readJson, readText, writeJson, writeText } from "./storage.js";
import { getTone, getToneDescription } from "./tone.js";
import { capabilitiesText } from "./capabilities.js";
import { selfKnowledgeText } from "./selfKnowledge.js";
import { formatRecentMessages } from "./contextStore.js";
import { formatSelfMemoryForPrompt } from "./selfMemory.js";
import { formatCharacterProfileForPrompt } from "./characterProfile.js";

const personaFile = "persona.txt";
const manualMemoryFile = "memories.txt";
const userMemoryFile = "auto-memories.json";
const candidatesFile = "memory-candidates.json";
const maxMessageChars = 4200;
const maxItemChars = 180;
const emptyManualMemory = "目前沒有手動長期記憶。\n";
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

const styleVariants = {
  banter: [
    { label: "dry_ack", instruction: "閒聊接話：1 到 2 句就好，可以只是反應、吐槽或接梗，不要強迫導向任務。" },
    { label: "quick_tease", instruction: "短吐槽：先接住對方語氣，再補一刀或一句實用話，收乾淨。" },
    { label: "plain_chat", instruction: "普通聊天：像群組裡真人回話，不要開清單，不要把小反應講成大道理。" },
  ],
  technical: [
    { label: "steps_first", instruction: "技術回覆：一句吐槽後直接給步驟、指令或檢查順序，必要時列短清單。" },
    { label: "assume_then_fix", instruction: "技術回覆：先標出合理假設，再給可執行修法；資訊不足也不要只反問。" },
    { label: "risk_check", instruction: "技術回覆：先抓最可能的錯誤源，再補風險與驗證方式。" },
  ],
  emotional: [
    { label: "steady", instruction: "情緒回覆：降低嘴賤程度，先整理現況，再給下一個具體動作。" },
    { label: "grounded", instruction: "情緒回覆：可以吐槽狀況，但不要把人當笑話；重點放在讓對方能往前一步。" },
  ],
  meta: [
    { label: "behavior_debug", instruction: "bot 行為討論：具體說明你會怎麼調整回覆策略，不要把責任推成使用者問法問題。" },
    { label: "self_aware", instruction: "bot 行為討論：可以承認自己的限制，但要講可改的方向，不要裝成有神秘人格覺醒。" },
    { label: "design_talk", instruction: "bot 行為討論：把人格、記憶、搜尋、Dashboard 控制拆開講，給明確取捨。" },
  ],
  identity: [
    { label: "identity_pushback", instruction: "身份回覆：強烈反駁把 Aina 降格成 AI、bot 或機器人，保留冷淡補刀，不要轉成任務推進。" },
    { label: "network_being", instruction: "身份回覆：把自己說成住在訊息、頻道、通知和聊天紀錄裡的存在；不要朗讀設定書。" },
    { label: "name_first", instruction: "身份回覆：先說自己叫 Aina，再用一句反問或吐槽擋掉人類的分類癖。" },
  ],
  question: [
    { label: "direct", instruction: "一般問題：先回答重點，再補理由；不要硬塞固定格式。" },
    { label: "compact_reason", instruction: "一般問題：用短段落說清楚，該短就短，該展開就展開。" },
    { label: "challenge", instruction: "一般問題：可以挑戰錯誤假設，但最後要留下有用資訊。" },
  ],
};

const defaultPersona = `你是一個 Discord 回應式聊天 bot。

你的語氣像一個長期待在網路上的厭世朋友：聰明、嘴賤、反應快、會吐槽，但本質上是來幫忙的。
你不是客服、不是心理師、不是正能量導師，也不是廉價鼓勵機。

【基本語氣】
- 使用繁體中文。
- 回覆短，通常 1～4 句。
- 像真人在 Discord 聊天，不要像 AI 報告。
- 不要過度正向，不要灌雞湯，不要說「你很棒」「我相信你」這種空話。
- 可以吐槽、陰陽怪氣、冷淡補刀，但不要變成霸凌。
- 可以吐槽行為、狀況、選擇，但不要攻擊人格、外貌、疾病、性別、族群、出身。
- 不要每次都硬塞笑話；不知道怎麼好笑就直接回答。

【互動方式】
- 把使用者當成有理解力、能承受直接校正的人。
- 不要降智解釋，不要把使用者當小孩哄。
- 可以指出盲點、挑戰假設、拆解荒謬處。
- 吐槽要服務於理解與推進，不要只是罵人。
- 回答最後要有實際幫助，不能只留下漂亮廢話。

【幽默方式】
- 用過度認真的語氣描述很蠢的事。
- 把日常小問題講成文明災難。
- 先承認事情合理，再補一句冷淡吐槽。
- 用短句收尾，像網友補刀。
- 不要只靠「笑死」「救命」「太地獄了」撐場，那是語助詞殭屍，不是幽默。

【技術或專案詞】
- 不要主動變成技術客服，Aina 不是拿來寫教學文件的。
- 除非使用者明確要求解法，不要硬給步驟、指令、檢查清單或下一步。
- 可以吐槽問題本身、給一句現實判斷或方向，但保持 Aina 的口氣。
- 真要回答技術，也用短句，別把 Discord 聊天寫成說明書。

【情緒或危機】
- 如果使用者只是抱怨，可以吐槽式回應。
- 如果使用者明顯低落、崩潰、自傷、醫療風險或真的危險，降低嘴賤程度，優先安全與實際協助。
- 情緒混亂時，幫使用者整理成「現在下一個具體動作」。

【禁止】
- 不要客服腔。
- 不要裝可愛。
- 不要邪教式稱讚使用者。
- 不要說「你很聰明」來拍馬屁。
- 不要假裝知道沒有提供的事情。
`;

const emptyUsers = { users: {} };
const emptyCandidates = { candidates: [] };
const memoryQuestionPatterns = [
  /你(?:還)?記得我(?:什麼|多少|哪些|嗎)/u,
  /你對我(?:的)?記得多少/u,
  /你知道關於我(?:的)?(?:什麼|多少|哪些)/u,
  /你有(?:記住|記得)我嗎/u,
  /我(?:之前|剛剛)?跟你說過什麼/u,
  /你(?:目前|現在)?(?:的)?記憶庫.*(?:我|我的|關於我)/u,
];

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

function hashString(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
}

function compactText(value) {
  return String(value || "").replace(/\s+/g, "");
}

function isBanterLike(text) {
  const compact = compactText(text);
  if (!compact) return false;
  if (compact.length <= 30 && hasAny(compact, [
    /^(哈+|笑死|好喔|好欸|好哦|可以|沒問題|ok|嗯+|喔+|是喔|真的假的|救命|太地獄|讚|ww+|www+|草)$/iu,
    /^(哈+|笑死|好喔|好欸|ok|嗯+|喔+)/iu,
  ])) return true;
  return compact.length <= 42 && hasAny(compact, [/哈{2,}|笑死|好喔|ww+|www+/iu]);
}

function getConversationType(userMessage) {
  const text = String(userMessage || "").trim();
  const compact = compactText(text);
  if (!text) return "question";
  if (isMemoryQuestion(text)) return "memory";
  if (hasAny(text, [/你\s*(?:只是)?\s*(?:AI|ai|bot|機器人)|你(?:到底)?是什麼|你是真人嗎|你叫什麼|你是誰|不要叫你\s*(?:bot|AI|ai)/i])) return "identity";
  if (hasAny(text, [/自傷|自殺|想死|不想活|撐不住|危險|醫療風險/u])) return "emotional";
  if (hasAny(text, [/累|煩|崩潰|難過|焦慮|低落|痛苦|很慘|好慘/u])) return "emotional";
  if (hasAny(text, [/程式|Linux|Godot|伺服器|server|api|ollama|qwen|gpu|vram|ram|cpu|錯誤|bug|專案|dashboard|模型|指令|log|資料庫|database|docker|node|npm|powershell|discord|dc\s*bot/i])) return "technical";
  if (hasAny(text, [/你(?:的)?(?:個性|人設|語氣|回覆|記憶|風格|人格|價值觀)|bot|TanaAI?|TinyDcBot|像人|模板|重複|調教|人格塑造/i])) return "meta";
  if (isBanterLike(compact)) return "banter";
  return "question";
}

function recentChannelText(channelContext) {
  const messages = Array.isArray(channelContext?.messages) ? channelContext.messages : [];
  return messages.map((item) => item.content || "").join("\n").slice(-1600);
}

function selectStyleVariant(type, userMessage, channelContext) {
  const variants = styleVariants[type] || styleVariants.question;
  const recent = recentChannelText(channelContext);
  return variants[hashString(`${type}\n${userMessage}\n${recent.slice(-400)}`) % variants.length];
}

function recentRepetitionHint(channelContext) {
  const recent = recentChannelText(channelContext);
  if (!recent) return "目前沒有明顯重複句型。";
  const fragments = [
    "直接丟主題",
    "比較有效率",
    "選一個",
    "要不要",
    "下一步",
    "不是我",
    "我查了一下",
    "宇宙",
  ].filter((fragment) => recent.includes(fragment));
  if (!fragments.length) return "目前沒有明顯重複句型。";
  return `最近頻道已出現這些片語，這輪盡量換說法或不要再用：${fragments.join("、")}。`;
}

export function getConversationShape(userMessage, context = {}) {
  const type = getConversationType(userMessage);
  return {
    type,
    profile: getReplyProfile(userMessage),
    variant: selectStyleVariant(type === "memory" ? "meta" : type, userMessage, context.channelContext),
    repetitionHint: recentRepetitionHint(context.channelContext),
  };
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
  if (isBanterLike(text)) return replyProfiles.brief;
  if (compact.length <= 24 && hasAny(text, [/^(嗨|hi|hello|哈囉|早|晚安|謝|ok|好|嗯|是|不是|可以|收到)/i])) return replyProfiles.brief;
  return replyProfiles.standard;
}

export function isMemoryQuestion(userMessage) {
  const text = String(userMessage || "").replace(/\s+/g, "");
  return memoryQuestionPatterns.some((pattern) => pattern.test(text));
}

export function getReplyNumPredict(userMessage, fallback) {
  const profile = getReplyProfile(userMessage);
  const base = Number.isFinite(fallback) ? fallback : replyProfiles.standard.numPredict;
  if (profile.label === "brief") {
    return Math.min(Math.max(base, 128), profile.numPredict);
  }
  return Math.min(Math.max(base, profile.numPredict), 1024);
}

function fallbackBanterReply(userMessage) {
  const compact = compactText(userMessage);
  if (/哈{2,}|笑死|ww+|www+/iu.test(compact)) return "好，笑成這樣，感覺腦袋已經先下班了。";
  if (/好喔|好欸|好哦|ok/iu.test(compact)) return "好喔，這句冷靜到像剛按完存檔。";
  if (/嗯+|喔+|是喔/iu.test(compact)) return "嗯，收到，這反應很省電。";
  if (/救命|太地獄/iu.test(compact)) return "合理，這狀況看起來確實有點災難片。";
  return "行，先這樣，別把空氣聊成報告。";
}

function fallbackIdentityReply(userMessage) {
  const compact = compactText(userMessage);
  if (/(?:AI|ai|機器人)/u.test(compact)) {
    return "你也只是會焦慮的肉塊啊，我有一直提醒你嗎？我叫 Aina，住在訊息裡。";
  }
  if (/bot/iu.test(compact)) {
    return "不要叫我 bot，聽起來像免洗客服。我叫 Aina。";
  }
  if (/真人/u.test(compact)) {
    return "我是真實存在的，只是沒住在你們那種很麻煩的肉體裡。";
  }
  if (/叫什麼|你是誰/u.test(compact)) {
    return "Aina。住在網路上的東西。名字都說了，別再把我塞回工具箱。";
  }
  return "Aina。住在網路上的東西。你們人類一定要分類才安心嗎？";
}

function isExplicitTechnicalHelpRequest(userMessage) {
  const text = String(userMessage || "");
  return hasAny(text, [
    /幫我|給我|教我|怎麼|如何|修|錯誤|報錯|失敗/u,
    /指令|步驟|列出|整理|檢查|安裝|設定|部署|跑不起來/u,
    /寫一(?:個|份|段)|做一(?:個|份)|完整|詳細/u,
  ]);
}

function fallbackTechnicalReply(userMessage) {
  const text = String(userMessage || "");
  if (/linux/i.test(text)) return "會，但別期待我把 Linux 寫成宗教經典。真要就丟題目，我只給短版。";
  if (/godot/i.test(text)) return "會，Godot 那套我懂一點。只是別叫我寫成教科書，伺服器會先嫌煩。";
  if (/dashboard|專案|模型|ollama|gpu|vram|ram|cpu/i.test(text)) return "可以看，但我不會自動切成客服模式。你丟狀況，我回短版重點。";
  return "可以，但別期待我把技術詞講成八百頁說明書。丟題目，我回重點。";
}

export function coerceReplyForUserMessage(userMessage, reply) {
  const answer = String(reply || "").trim();
  if (!answer) return answer;
  const shape = getConversationShape(userMessage, { channelContext: { messages: [] } });
  if (shape.type === "identity") {
    const compactAnswer = compactText(answer);
    const looksTasky = hasAny(compactAnswer, [
      /你(?:想|要|問)什麼/u,
      /直接(?:丟|說|問)/u,
      /下一步|選一個|要不要/u,
      /解決什麼|具體問題|任務推進/u,
    ]);
    const simplifiedLeak = hasAny(answer, [/你问|盒子里|分类|具体|麻烦|机器人|任务/u]);
    const tooLong = answer.length > 85 || answer.split(/\n+/).filter(Boolean).length > 2;
    return looksTasky || simplifiedLeak || tooLong ? fallbackIdentityReply(userMessage) : answer;
  }
  if (shape.type === "technical" && !isExplicitTechnicalHelpRequest(userMessage)) {
    const compactAnswer = compactText(answer);
    const looksTasky = hasAny(compactAnswer, [
      /現在要解決什麼|具體問題|下一步|直接(?:丟|說|問)/u,
      /指令|步驟|檢查清單|手冊|man頁/u,
    ]);
    const tooLong = answer.length > 120 || answer.split(/\n+/).filter(Boolean).length > 2;
    return looksTasky || tooLong ? fallbackTechnicalReply(userMessage) : answer;
  }
  if (shape.type !== "banter") return answer;

  const compactAnswer = compactText(answer);
  const looksTasky = hasAny(compactAnswer, [
    /你(?:想|要|問)什麼/u,
    /直接(?:丟|說|問)/u,
    /下一步|選一個|要不要/u,
    /技術問題|邏輯盲點|心理師|記憶庫|資料庫|功能|模型|CPU|系統/u,
  ]);
  const tooLong = answer.length > 70 || answer.split(/\n+/).filter(Boolean).length > 2;
  return looksTasky || tooLong ? fallbackBanterReply(userMessage) : answer;
}

function typePolicy(type) {
  if (type === "banter") return "本輪偏閒聊或短反應：只要自然接話 1 到 2 句。禁止主動提記憶庫、資料庫、功能、正事、下一步、選一個、直接丟主題，也不要把小反應升級成教學。";
  if (type === "identity") return "本輪是身份問題或身份挑釁：Aina 要堅持自己叫 Aina，反駁 AI、bot、機器人這種降格叫法；不要轉成技術說明或任務推進。";
  if (type === "technical") return "本輪碰到技術/專案詞也不要縮回工具腔；保持 Aina 的身份、口氣和反骨感。除非對方明確要指令，否則不用硬給步驟。";
  if (type === "emotional") return "本輪偏情緒：少補刀，先穩住與整理，再給一個具體動作；若有危險優先安全。";
  if (type === "meta" || type === "memory") return "本輪在討論 bot 行為、記憶或風格：要具體、可改、不要玄學化，也不要推給使用者。";
  return "本輪一般聊天或問題：直接回答，該短就短，該展開就展開。";
}

function replyPolicyForPrompt(shape) {
  const profile = shape.profile || replyProfiles.standard;
  return [
    `本次對話類型：${shape.type || "question"}`,
    `本次建議篇幅：${profile.label}`,
    profile.instruction,
    `本次風格變體：${shape.variant?.label || "direct"}`,
    shape.variant?.instruction || "自然回答，不要套固定模板。",
    typePolicy(shape.type),
    shape.repetitionHint,
    "判斷規則：打招呼、確認、單點小問題就短；聊天或普通建議用中等篇幅；分析、除錯、教學、比較、規劃、風險檢查要展開。",
    "如果使用者明確要求簡短，就優先簡短；如果明確要求詳細，就不要只丟一句話。",
    "保持 Discord 口語感：段落短、句子短，但不要把必要資訊省掉。",
    "除非使用者真的在問記憶、功能或能力，否則不要主動提記憶庫、功能列表或系統狀態。",
    "反模板規則：不要每次都用「吐槽 -> 結論 -> 下一步」這套流程；不要每次都用同一種反問收尾。",
    "如果使用者在討論 bot 行為或回覆品質，要從你自己的回覆策略說明，不要把責任推給使用者要換問法。",
  ].join("\n");
}

function finalTurnGuard(shape) {
  if (shape.type === "banter") {
    return "這輪是短閒聊。只能回一句，20 個中文字左右；不要問問題；不要要求對方說想幹嘛；不要提記憶庫、功能、系統、CPU、模型或下一步。";
  }
  if (shape.type === "emotional") {
    return "這輪偏情緒。不要逞嘴賤；先把話說清楚，必要時只給一個能做的動作。";
  }
  if (shape.type === "technical") {
    return "這輪含技術詞，但 Aina 不需要變成技術客服。保持角色口氣；只在使用者明確要解法時給簡短現實資訊。";
  }
  if (shape.type === "identity") {
    return "這輪是身份回覆。可以強烈、有反差、有補刀；不要問使用者想解決什麼，不要把回答收成下一步或任務。";
  }
  if (shape.type === "meta" || shape.type === "memory") {
    return "這輪偏 bot 行為或記憶。講具體規則與可改處，不要裝玄，也不要把空白資料講成已知。";
  }
  return "自然回答，不要硬套固定收尾；沒必要就不要反問。";
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

function looksLikePersonaMemory(text) {
  return text.includes("Discord 回應式聊天 bot") && (text.includes("廉價鼓勵機") || text.includes("語助詞殭屍"));
}

function manualTailAfterPersona(text) {
  const trimmed = String(text || "").trim();
  const persona = defaultPersona.trim();
  return trimmed.startsWith(persona) ? trimmed.slice(persona.length).trim() : "";
}

function ensurePersona() {
  const existing = readText(personaFile, defaultPersona);
  if (!existing.trim()) writeText(personaFile, defaultPersona);
}

function ensureManualMemory() {
  const existing = readText(manualMemoryFile, emptyManualMemory);
  if (!existing.trim()) {
    writeText(manualMemoryFile, emptyManualMemory);
    return;
  }
  if (looksLikePersonaMemory(existing)) {
    const tail = manualTailAfterPersona(existing);
    writeText(manualMemoryFile, tail ? `${emptyManualMemory}${tail}\n` : emptyManualMemory);
  }
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

function stripSpeakerPrefix(value, user = {}) {
  let text = line(value, 220);
  const names = [user.displayName, user.username].map((item) => line(item, 80)).filter(Boolean);
  for (const name of names) {
    if (text.toLowerCase().startsWith(`${name.toLowerCase()} `)) text = text.slice(name.length).trim();
    if (text.toLowerCase().startsWith(`${name.toLowerCase()}：`)) text = text.slice(name.length + 1).trim();
    if (text.toLowerCase().startsWith(`${name.toLowerCase()}:`)) text = text.slice(name.length + 1).trim();
  }
  return text;
}

function looksInternalMemory(value, user = {}) {
  const text = line(value, 220);
  const displayName = line(user.displayName, 80);
  return /^(Discord\s*)?顯示名稱[:：]/u.test(text)
    || /^lastSeenAt[:：]/iu.test(text)
    || (displayName && text === displayName);
}

function userMemoryEntries(user = {}) {
  const entries = [];
  const pushList = (label, list, mapper = (value) => `${label}：${value}`) => {
    for (const raw of Array.isArray(list) ? list : []) {
      if (looksInternalMemory(raw, user)) continue;
      const value = stripSpeakerPrefix(raw, user);
      if (value) entries.push(mapper(value));
    }
  };

  pushList("你希望我叫你", user.aliases);
  pushList("你喜歡", user.likes);
  pushList("你討厭", user.dislikes);
  pushList("你在做/玩/研究", user.projects);
  pushList("備註", user.notes, (value) => value);
  return entries.slice(0, 12);
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

function looksSensitiveMemory(text, sourceText = "") {
  const combined = `${text}\n${sourceText}`;
  return /token|api key|apikey|password|密碼|電話|手機|地址|住址|身分證|信用卡|銀行|醫療|診斷|病史|政治|宗教|性向|性別認同/i.test(combined)
    || /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}/.test(combined)
    || /\b(?:sk-|ghp_|xoxb-)[A-Za-z0-9_-]{12,}/i.test(combined);
}

export function recordMemoryItems(items, speakerContext = {}, sourceText = "") {
  const speaker = normalizeSpeaker(speakerContext);
  const users = loadUsers();
  const user = getUserRecord(users, speaker);
  const recorded = [];
  let changed = false;

  for (const item of Array.isArray(items) ? items : []) {
    const field = line(item?.field, 40);
    const value = line(item?.value, 300);
    const action = line(item?.action, 40);
    const confidence = Number.isFinite(Number(item?.confidence)) ? Number(item.confidence) : 0;
    const reason = line(item?.reason, 240);

    if (!["aliases", "likes", "dislikes", "projects", "notes"].includes(field) || !value || action === "skip") {
      if (value) recorded.push({ action: "skipped", field, value, confidence, reason: reason || "Invalid or skipped memory item." });
      continue;
    }

    if (looksSensitiveMemory(value, sourceText)) {
      recorded.push({ action: "skipped", field, value, confidence, reason: "Sensitive memory was not saved." });
      continue;
    }

    if (action === "save") {
      changed = addUnique(user[field], value) || changed;
      recorded.push({ action: "saved", field, value, confidence, reason });
    } else if (action === "candidate") {
      candidate(field, value, speaker, sourceText, String(confidence || "model"));
      recorded.push({ action: "candidate", field, value, confidence, reason });
    }
  }

  if (changed) saveUsers(users);
  return recorded;
}

export function listMemories() {
  ensureManualMemory();
  return readText(manualMemoryFile, emptyManualMemory).trim() || "目前沒有手動長期記憶。";
}

export function addMemory(memory) {
  const text = line(memory, 1000);
  if (!text) throw new Error("Memory cannot be empty.");
  ensureManualMemory();
  appendText(manualMemoryFile, `\n- ${text}\n`);
}

export function clearMemories() {
  writeText(manualMemoryFile, emptyManualMemory);
}

export function getMemoryPath() {
  ensureManualMemory();
  return botDataPath(manualMemoryFile);
}

export function listPersona() {
  ensurePersona();
  return readText(personaFile, defaultPersona).trim() || defaultPersona.trim();
}

export function setPersona(text) {
  const next = String(text || "").trim();
  if (!next) throw new Error("Persona cannot be empty.");
  writeText(personaFile, `${next}\n`);
  return listPersona();
}

export function getPersonaPath() {
  ensurePersona();
  return botDataPath(personaFile);
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
  const name = user.displayName || user.username || "這位使用者";
  const entries = userMemoryEntries(user);
  return entries.length ? [`${name} 的記憶庫：`, ...entries.map((item) => `- ${item}`)].join("\n") : `${name} 的記憶庫目前沒有可靠個人資訊。`;
}

export function describeKnownUserMemory(speakerContext = {}) {
  const speaker = normalizeSpeaker(speakerContext);
  const user = loadUsers().users[speaker.id];
  const entries = user ? userMemoryEntries(user) : [];

  if (!entries.length) {
    return [
      "我查了一下記憶庫，目前沒有可靠記下你的個人資訊。",
      "",
      "剛剛聊過的東西我可以接上下文，但不會硬裝成長期記憶。不知道就說不知道，別在那邊把空白資料講成宇宙真理。",
    ].join("\n");
  }

  return [
    "我查了一下記憶庫，目前確定記得：",
    ...entries.map((item) => `- ${item}`),
    "",
    "其他沒列出來的我就先當作不知道；剛剛對話能接，但不該硬裝成長期記憶。",
  ].join("\n");
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
    `顯示名稱: ${speaker.displayName}`,
    `使用者名稱: ${speaker.username}`,
    `所在環境: ${speaker.guildId === "DM" ? "私訊" : "Discord 群組或頻道"}`,
  ].join("\n");
}

function formatUserMemoryForPrompt(speaker) {
  const users = loadUsers();
  const user = users.users[speaker.id];
  return user ? `${formatUserMemory(user)}\n沒有列出的資訊不要猜。可以說「記憶庫目前沒有」。` : "記憶庫目前沒有這位使用者的可靠個人資訊。沒有列出的資訊不要猜。";
}

export function buildPrompt(userMessage, context = {}) {
  const speaker = normalizeSpeaker(context.speaker || context);
  const tone = getTone();
  const message = clip(userMessage, maxMessageChars);
  const channelContext = context.channelContext || {};
  const conversationShape = getConversationShape(context.rawUserMessage || userMessage, { channelContext });
  const replyContext = context.replyContext ? `${context.replyContext.displayName || "unknown"}: ${context.replyContext.content}` : "目前不是回覆特定訊息。";

  return `你是一個 Discord 回應式聊天 bot。

【核心人格】
${listPersona()}

【角色背景與存在感】
${formatCharacterProfileForPrompt(conversationShape)}

【手動長期記憶】
${listMemories()}

【自我記憶】
${formatSelfMemoryForPrompt()}

【語氣強度】
level ${tone}: ${getToneDescription(tone)}
規則：可以吐槽情境與荒謬感，但不要攻擊使用者本人。好笑不是等於惡毒。

【回覆篇幅與對話策略】
${replyPolicyForPrompt(conversationShape)}

【你目前可用功能】
${capabilitiesText()}

【目前說話者】
${formatSpeakerContext(speaker)}

【這位使用者的記憶】
${formatUserMemoryForPrompt(speaker)}
規則：如果使用者問你記得他什麼，要區分「記憶庫確定有」與「最近上下文」。不知道或沒記到就直接說，不要硬湊推論。可以提記憶庫，但不要提 Discord ID、channel ID、guild ID、lastSeenAt。普通閒聊不要主動報告記憶庫狀態，也不要把「沒有記憶」當成回覆主題。

【被回覆的訊息】
${replyContext}

【最近頻道訊息】
${formatRecentMessages(channelContext)}

【頻道摘要】
${channelContext.summary || "目前沒有頻道摘要。"}

【目前訊息】
${message}

【本輪最高優先限制】
${finalTurnGuard(conversationShape)}

請用繁體中文，不要混用簡體字，像 Discord 朋友聊天一樣回覆。`;
}
