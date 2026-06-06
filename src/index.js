import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import { askOllama } from "./ollamaClient.js";
import { config, validateConfig } from "./config.js";
import { capabilitiesText, isCapabilitiesQuestion } from "./capabilities.js";
import {
  findChannelMessage,
  getChannelContext,
  recordChannelMessage,
  resetChannelContext,
} from "./contextStore.js";
import {
  addMemory,
  addUserMemory,
  approveMemoryCandidate,
  clearAutoMemories,
  clearMemories,
  clearMemoryCandidates,
  describeKnownUserMemory,
  forgetUserMemory,
  getMemoryCandidates,
  isMemoryQuestion,
  listAutoMemories,
  listMemories,
  rejectMemoryCandidate,
} from "./promptMemory.js";
import {
  addReminder,
  clearReminders,
  completeReminder,
  detectReminderCandidate,
  dueReminders,
  formatReminder,
  listReminders,
} from "./reminders.js";
import { getTone, getToneDescription, setTone } from "./tone.js";
import { shouldSearch, stripSearchPrefix } from "./webSearch.js";
import { getWeather } from "./weather.js";
import { logConversationEvent } from "./conversationLog.js";
import { selfKnowledgeText } from "./selfKnowledge.js";
import { applyDecisionMemory, buildSearchAugmentedPrompt, decideTurn } from "./turnDecision.js";
import { learnSelfMemoryFromTurn } from "./selfMemory.js";

const cooldowns = new Map();

const text = {
  emptyPrompt: "你想問我什麼？",
  emptyInput: "你要先在 input 欄位輸入內容，不然我只能望著空白發呆。",
  notAllowed: "這個頻道或使用者目前不在允許清單裡。",
  cooldown: "等我一下，上一則還在冷卻。",
  localModelError: "我現在連不到本機模型，先確認 Ollama 有沒有開著，模型也有沒有下載好。",
  resourceLimit: "本機模型現在載不動，資源不夠。不是我擺爛，是電腦在喊救命。先用 /capabilities、/self 或等我把小模型切好。",
  gpuBusy: "GPU 顯存現在太滿，我先不載模型，免得改吃你的主記憶體把整台拖下去。先關掉吃顯存的東西，或晚點再叫我。",
  commandError: "我現在處理不了這則指令，先看 Dashboard 的 Bot err log。",
};

function getTriggerPrefix(message) {
  const content = (message.content || "").trimStart();
  const lowered = content.toLowerCase();
  return config.triggerPrefixes.find((prefix) => lowered.startsWith(prefix.toLowerCase())) || "";
}

function isAllowedUser(userId) {
  return config.allowedUserIds.size === 0 || config.allowedUserIds.has(userId);
}

function isAllowedChannel(channelId) {
  return config.allowedChannelIds.size === 0 || config.allowedChannelIds.has(channelId);
}

function isReplyToBot(message, replyContext, client) {
  if (!config.replyToBotReplies || !client.user) return false;
  if (replyContext?.authorId === client.user.id) return true;
  return message.mentions?.repliedUser?.id === client.user.id;
}

function isAllowedMessage(message, client, replyContext = null) {
  if (message.author.bot) return false;
  if (!isAllowedUser(message.author.id) || !isAllowedChannel(message.channelId)) return false;
  return !(config.requireMention && message.guildId && !message.mentions.has(client.user) && !getTriggerPrefix(message) && !isReplyToBot(message, replyContext, client));
}

function speakerFromMessage(message) {
  return {
    id: message.author.id,
    username: message.author.username,
    displayName: message.member?.displayName || message.author.globalName || message.author.username,
    channelId: message.channelId,
    guildId: message.guildId || "DM",
  };
}

function speakerFromInteraction(interaction) {
  return {
    id: interaction.user.id,
    username: interaction.user.username,
    displayName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
    channelId: interaction.channelId,
    guildId: interaction.guildId || "DM",
  };
}

function cleanPrompt(message, client) {
  let content = message.content || "";
  if (client.user) {
    content = content.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "");
  }
  const triggerPrefix = getTriggerPrefix(message);
  if (triggerPrefix) content = content.slice(triggerPrefix.length).replace(/^[\s,:;>\-]+/, "");
  content = content.trim();
  return content.length > config.maxInputChars ? content.slice(0, config.maxInputChars) : content;
}

function trimReply(content) {
  if (content.length <= config.maxReplyChars) return content;
  return `${content.slice(0, config.maxReplyChars - 20).trimEnd()}\n\n[reply trimmed]`;
}

function learnSelfMemorySafe(turn) {
  try {
    return learnSelfMemoryFromTurn(turn);
  } catch (error) {
    console.warn("Self-memory learning failed:", error?.message || error);
    return [];
  }
}

function onCooldown(userId) {
  if (config.cooldownMs <= 0) return false;
  const now = Date.now();
  const last = cooldowns.get(userId) || 0;
  if (now - last < config.cooldownMs) return true;
  cooldowns.set(userId, now);
  return false;
}

async function replyContextFromMessage(message, client) {
  if (!message.reference?.messageId) return null;
  const referencedId = message.reference.messageId;
  try {
    const replied = await message.channel.messages.fetch(referencedId);
    return {
      id: replied.id,
      authorId: replied.author.id,
      displayName: replied.member?.displayName || replied.author.globalName || replied.author.username,
      content: String(replied.content || "").slice(0, 800),
    };
  } catch {
    const stored = findChannelMessage(message.channelId, referencedId);
    if (stored) {
      return {
        id: stored.id,
        authorId: stored.authorId,
        displayName: stored.displayName || stored.username || "unknown",
        content: String(stored.content || "").slice(0, 800),
      };
    }

    const repliedUser = message.mentions?.repliedUser;
    if (repliedUser) {
      return {
        id: referencedId,
        authorId: repliedUser.id,
        displayName: repliedUser.globalName || repliedUser.username,
        content: repliedUser.id === client.user?.id ? "Discord reply to the bot. Original message content was not available." : "",
      };
    }

    return null;
  }
}

function recordDiscordMessage(message) {
  if (message.author.bot || !message.content?.trim()) return;
  if (!isAllowedChannel(message.channelId)) return;
  const speaker = speakerFromMessage(message);
  recordChannelMessage({
    id: message.id,
    channelId: message.channelId,
    authorId: speaker.id,
    displayName: speaker.displayName,
    username: speaker.username,
    content: message.content,
    createdAt: message.createdAt?.toISOString?.() || new Date().toISOString(),
  });
}

function recordOutgoingBotMessage(message, content, client) {
  if (!message?.id || !message.channelId || !content) return;
  recordChannelMessage({
    id: message.id,
    channelId: message.channelId,
    authorId: message.author?.id || client.user?.id || "bot",
    displayName: message.member?.displayName || client.user?.globalName || client.user?.username || "TinyDcBot",
    username: message.author?.username || client.user?.username || "TinyDcBot",
    content,
    createdAt: message.createdAt?.toISOString?.() || new Date().toISOString(),
  });
}

function buildCommands() {
  return [
    new SlashCommandBuilder().setName("help").setDescription("Show TinyDcBot commands.").toJSON(),
    new SlashCommandBuilder().setName("capabilities").setDescription("Show what this bot can do.").toJSON(),
    new SlashCommandBuilder().setName("self").setDescription("Show read-only self knowledge and recent updates.").toJSON(),
    new SlashCommandBuilder().setName("status").setDescription("Show local bot status.").toJSON(),
    new SlashCommandBuilder().setName("model").setDescription("Show the current local model.").toJSON(),
    new SlashCommandBuilder().setName("reset").setDescription("Clear this channel context.").toJSON(),
    new SlashCommandBuilder()
      .setName("context")
      .setDescription("Ask the local Ollama model through TinyDcBot.")
      .addStringOption((option) => option.setName("input").setDescription("Question for qwen.").setRequired(true).setMaxLength(config.maxInputChars))
      .addBooleanOption((option) => option.setName("search").setDescription("Search the web once before answering.").setRequired(false))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("search")
      .setDescription("Search the web once, then ask qwen.")
      .addStringOption((option) => option.setName("input").setDescription("Search query and question.").setRequired(true).setMaxLength(config.maxInputChars))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("weather")
      .setDescription("Get current weather without an API key.")
      .addStringOption((option) => option.setName("location").setDescription("Location, for example Taipei.").setRequired(true).setMaxLength(120))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("profile")
      .setDescription("Manage your local per-user memory.")
      .addSubcommand((command) => command.setName("list").setDescription("List your memory."))
      .addSubcommand((command) => command.setName("clear").setDescription("Clear your memory."))
      .addSubcommand((command) => command.setName("add").setDescription("Add one memory field.")
        .addStringOption((option) => option.setName("field").setDescription("aliases, likes, dislikes, projects, notes").setRequired(true))
        .addStringOption((option) => option.setName("value").setDescription("Memory value.").setRequired(true).setMaxLength(300)))
      .addSubcommand((command) => command.setName("forget").setDescription("Forget a field or value.")
        .addStringOption((option) => option.setName("field").setDescription("aliases, likes, dislikes, projects, notes").setRequired(false))
        .addStringOption((option) => option.setName("value").setDescription("Exact value to remove.").setRequired(false).setMaxLength(300)))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("memory")
      .setDescription("Manage long-term and candidate memory.")
      .addSubcommand((command) => command.setName("list").setDescription("List manual long-term memory."))
      .addSubcommand((command) => command.setName("add").setDescription("Add manual long-term memory.")
        .addStringOption((option) => option.setName("text").setDescription("Memory text.").setRequired(true).setMaxLength(1000)))
      .addSubcommand((command) => command.setName("clear").setDescription("Clear manual long-term memory."))
      .addSubcommandGroup((group) => group.setName("candidates").setDescription("Review memory candidates.")
        .addSubcommand((command) => command.setName("list").setDescription("List candidates."))
        .addSubcommand((command) => command.setName("approve").setDescription("Approve candidate.").addStringOption((option) => option.setName("id").setDescription("Candidate id.").setRequired(true)))
        .addSubcommand((command) => command.setName("reject").setDescription("Reject candidate.").addStringOption((option) => option.setName("id").setDescription("Candidate id.").setRequired(true)))
        .addSubcommand((command) => command.setName("clear").setDescription("Clear all candidates.")))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("tone")
      .setDescription("Get or set roast level.")
      .addSubcommand((command) => command.setName("get").setDescription("Show current tone."))
      .addSubcommand((command) => command.setName("set").setDescription("Set tone level.").addIntegerOption((option) => option.setName("level").setDescription("0 normal, 1 light, 2 sharp, 3 strong").setRequired(true).setMinValue(0).setMaxValue(3)))
      .toJSON(),
    new SlashCommandBuilder()
      .setName("remind")
      .setDescription("Manage local reminders.")
      .addSubcommand((command) => command.setName("add").setDescription("Add reminder.")
        .addStringOption((option) => option.setName("text").setDescription("Reminder text.").setRequired(true).setMaxLength(500))
        .addStringOption((option) => option.setName("time").setDescription("ISO, tomorrow 09:00, 10m, 2h.").setRequired(true).setMaxLength(120)))
      .addSubcommand((command) => command.setName("list").setDescription("List your active reminders."))
      .addSubcommand((command) => command.setName("done").setDescription("Mark reminder done.").addStringOption((option) => option.setName("id").setDescription("Reminder id.").setRequired(true)))
      .addSubcommand((command) => command.setName("clear").setDescription("Clear your reminders."))
      .toJSON(),
  ];
}

function getInteractionInput(interaction) {
  const option = interaction.options.data.find((item) => item.name === "input" || item.name === "message");
  return typeof option?.value === "string" ? option.value.trim() : "";
}

async function registerCommands(client) {
  if (!config.discordClientId) {
    console.warn("DISCORD_CLIENT_ID is missing; slash command registration skipped.");
    return;
  }
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const guildIds = config.discordGuildId ? [config.discordGuildId] : Array.from(client.guilds.cache.keys());
  for (const guildId of guildIds) {
    await rest.put(Routes.applicationGuildCommands(config.discordClientId, guildId), { body: buildCommands() });
    console.log(`Registered slash commands for guild ${guildId}`);
  }
}

async function answerPrompt(prompt, speaker, options = {}) {
  if (!prompt) return text.emptyPrompt;
  if (isCapabilitiesQuestion(prompt)) return capabilitiesText().slice(0, config.maxReplyChars);
  if (isMemoryQuestion(prompt)) {
    const answer = trimReply(describeKnownUserMemory(speaker));
    logConversationEvent({
      type: options.logType || "answered-turn",
      source: options.source || "discord",
      channelId: speaker.channelId,
      userId: speaker.id,
      displayName: speaker.displayName,
      input: prompt,
      reply: answer,
      searched: false,
      memoryItems: [],
      meta: { handledBy: "memory-question", selfMemoryItems: [] },
    });
    return answer;
  }
  const reminderCandidate = detectReminderCandidate(prompt);
  if (reminderCandidate && !options.allowModelForReminderCandidate) {
    return `這看起來像提醒事項，但我不現場亂猜時間。${reminderCandidate.hint}`;
  }
  const channelContext = getChannelContext(speaker.channelId);
  const forceSearch = Boolean(options.forceSearch) || shouldSearch(prompt);
  const cleanPrompt = forceSearch && shouldSearch(prompt) ? stripSearchPrefix(prompt) : prompt;
  const decision = await decideTurn({
    message: cleanPrompt,
    speaker,
    channelContext,
    replyContext: options.replyContext || null,
    source: options.source || "discord",
    forceSearch,
  });
  const memoryItems = applyDecisionMemory(decision, speaker, cleanPrompt);
  const prepared = await buildSearchAugmentedPrompt(cleanPrompt, decision);
  const promptContext = {
    speaker,
    channelContext,
    replyContext: options.replyContext || null,
  };
  console.log(`Replying channel=${speaker.channelId} user=${speaker.id} name=${speaker.displayName} promptChars=${prompt.length} search=${prepared.searched} query=${prepared.searchQuery || ""}`);
  const answer = trimReply(await askOllama(prepared.prompt, promptContext, cleanPrompt));
  const selfMemoryItems = learnSelfMemorySafe({
    input: cleanPrompt,
    reply: answer,
    speaker,
    source: options.source || "discord",
  });
  logConversationEvent({
    type: options.logType || "answered-turn",
    source: options.source || "discord",
    channelId: speaker.channelId,
    userId: speaker.id,
    displayName: speaker.displayName,
    input: cleanPrompt,
    reply: answer,
    searched: prepared.searched,
    memoryItems,
    meta: {
      autonomyDecision: decision,
      searchQuery: prepared.searchQuery,
      searchError: prepared.searchError,
      searchResultCount: prepared.searchResults?.length || 0,
      selfMemoryItems,
    },
  });
  return answer;
}

async function handleProfileCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const speaker = speakerFromInteraction(interaction);
  if (sub === "list") return interaction.reply(`這是我對你的本地記憶：\n${listAutoMemories(speaker.id).slice(0, 1800)}`);
  if (sub === "clear") {
    clearAutoMemories(speaker.id);
    return interaction.reply("你的自動個人記憶清掉了。核心人格沒動，腦袋沒有被整台格式化。");
  }
  if (sub === "add") {
    const field = interaction.options.getString("field", true);
    const value = interaction.options.getString("value", true);
    addUserMemory(speaker.id, field, value, speaker);
    return interaction.reply(`記到你的 ${field} 了。這次不是亂貼便利貼。`);
  }
  if (sub === "forget") {
    forgetUserMemory(speaker.id, interaction.options.getString("field") || "", interaction.options.getString("value") || "");
    return interaction.reply("忘掉了。這種乾脆程度值得某些待辦清單學一下。");
  }
}

async function handleMemoryCommand(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  if (group === "candidates") {
    if (sub === "list") {
      const items = getMemoryCandidates().candidates;
      const textOut = items.length ? items.map((item) => `${item.id} | ${item.displayName} | ${item.kind}: ${item.value}`).join("\n") : "目前沒有候選記憶。";
      return interaction.reply(textOut.slice(0, 1900));
    }
    if (sub === "approve") {
      approveMemoryCandidate(interaction.options.getString("id", true));
      return interaction.reply("候選記憶已批准。終於不是亂記一通了。`/profile list` 可以看結果。");
    }
    if (sub === "reject") {
      rejectMemoryCandidate(interaction.options.getString("id", true));
      return interaction.reply("候選記憶已拒絕。垃圾資訊就該進垃圾桶。");
    }
    if (sub === "clear") {
      clearMemoryCandidates();
      return interaction.reply("候選記憶清空。腦內便利貼大掃除完成。");
    }
  }
  if (sub === "list") return interaction.reply(`目前手動長期記憶：\n${listMemories().slice(0, 1800)}`);
  if (sub === "add") {
    addMemory(interaction.options.getString("text", true));
    return interaction.reply("手動長期記憶已加入。這份比較像正史，不是小道消息。");
  }
  if (sub === "clear") {
    clearMemories();
    return interaction.reply("手動長期記憶清空。核心人設沒有炸，只是筆記清掉了。");
  }
}

async function handleToneCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === "get") return interaction.reply(`目前 tone level ${getTone()}: ${getToneDescription()}`);
  const level = setTone(interaction.options.getInteger("level", true));
  return interaction.reply(`Tone 改成 level ${level}: ${getToneDescription(level)}。火力有旋鈕了，不用靠玄學。`);
}

async function handleReminderCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const speaker = speakerFromInteraction(interaction);
  if (sub === "add") {
    const item = addReminder({ userId: speaker.id, channelId: speaker.channelId, text: interaction.options.getString("text", true), dueAt: interaction.options.getString("time", true) });
    return interaction.reply(`提醒已建立：${formatReminder(item)}`);
  }
  if (sub === "list") {
    const items = listReminders({ userId: speaker.id, activeOnly: true });
    return interaction.reply((items.length ? items.map(formatReminder).join("\n") : "你目前沒有待提醒事項。意外地清爽。").slice(0, 1900));
  }
  if (sub === "done") {
    completeReminder(interaction.options.getString("id", true));
    return interaction.reply("提醒已完成。待辦少一個，人生未必變輕但至少列表變短。");
  }
  if (sub === "clear") {
    clearReminders(speaker.id);
    return interaction.reply("你的提醒清掉了。希望不是把人生計畫也一起清了。 ");
  }
}

async function handleWeatherCommand(interaction) {
  await interaction.deferReply();
  try {
    const weather = await getWeather(interaction.options.getString("location", true));
    await interaction.editReply(`${weather}\n天氣就這樣，宇宙沒有特別為你調整。`);
  } catch (error) {
    console.error(error);
    await interaction.editReply("天氣查不到。不是天空壞了，是查詢服務或網路又在演。");
  }
}

async function handleAskCommand(interaction, forceSearch) {
  if (!isAllowedUser(interaction.user.id) || !isAllowedChannel(interaction.channelId)) return interaction.reply({ content: text.notAllowed, ephemeral: true });
  if (onCooldown(interaction.user.id)) return interaction.reply({ content: text.cooldown, ephemeral: true });
  await interaction.deferReply();
  try {
    const prompt = getInteractionInput(interaction);
    if (!prompt) return interaction.editReply(text.emptyInput);
    const speaker = speakerFromInteraction(interaction);
    const answer = await answerPrompt(prompt, speaker, { forceSearch, source: interaction.commandName, logType: "slash-input" });
    const sent = await interaction.editReply(answer);
    recordOutgoingBotMessage(sent, answer, interaction.client);
  } catch (error) {
    console.error(error);
    await interaction.editReply(error?.message === "MODEL_GPU_BUSY" ? text.gpuBusy : error?.message === "MODEL_RESOURCE_LIMIT" ? text.resourceLimit : text.commandError);
  }
}

async function handleCommand(interaction) {
  switch (interaction.commandName) {
    case "help":
    case "capabilities": return interaction.reply(capabilitiesText().slice(0, 1900));
    case "status": return interaction.reply([`Bot：在線`, `Model：${config.ollamaModel}`, `Tone：${getTone()} ${getToneDescription()}`, `Web search：${config.allowWebSearch ? "on" : "off"}`].join("\n"));
    case "model": return interaction.reply(`現在用的是 \`${config.ollamaModel}\`。小模型上工，別叫它扛核電廠。`);
    case "reset": resetChannelContext(interaction.channelId); return interaction.reply("這個頻道的最近上下文清掉了。不是失憶，是重開一張乾淨桌面。");
    case "profile": return handleProfileCommand(interaction);
    case "memory": return handleMemoryCommand(interaction);
    case "tone": return handleToneCommand(interaction);
    case "remind": return handleReminderCommand(interaction);
    case "weather": return handleWeatherCommand(interaction);
    case "search": return handleAskCommand(interaction, true);
    case "context": return handleAskCommand(interaction, Boolean(interaction.options.data.find((item) => item.name === "search")?.value));
    default: return interaction.reply({ content: "這指令我不認識。打 /help，別跟選單玩捉迷藏。", ephemeral: true });
  }
}

async function deliverDueReminders(client) {
  for (const item of dueReminders()) {
    try {
      const channel = await client.channels.fetch(item.channelId);
      await channel?.send(`<@${item.userId}> 提醒：${item.text}`);
    } catch (error) {
      console.error("Reminder delivery failed:", error);
    }
  }
}

validateConfig();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel, Partials.Message],
});

client.once("clientReady", async () => {
  console.log(`TinyDcBot ready as ${client.user.tag}`);
  console.log(`Ollama model: ${config.ollamaModel}`);
  console.log(`Ollama base URL: ${config.ollamaBaseUrl}`);
  console.log(`Ollama model path: ${config.ollamaModels}`);
  console.log(`Mention required in guilds: ${config.requireMention}`);
  console.log(`Trigger prefixes: ${config.triggerPrefixes.join(", ")}`);
  console.log(`Guild count: ${client.guilds.cache.size}`);
  try { await registerCommands(client); } catch (error) { console.error("Slash command registration failed:", error); }
  setInterval(() => deliverDueReminders(client), 30000).unref();
});

client.on("messageCreate", async (message) => {
  recordDiscordMessage(message);
  try {
    const replyContext = await replyContextFromMessage(message, client);
    if (!isAllowedMessage(message, client, replyContext) || onCooldown(message.author.id)) return;
    await message.channel.sendTyping();
    const prompt = cleanPrompt(message, client);
    const answer = await answerPrompt(prompt, speakerFromMessage(message), { replyContext });
    const sent = await message.reply(answer);
    recordOutgoingBotMessage(sent, answer, client);
  } catch (error) {
    console.error(error);
    await message.reply(error?.message === "MODEL_GPU_BUSY" ? text.gpuBusy : error?.message === "MODEL_RESOURCE_LIMIT" ? text.resourceLimit : text.localModelError);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  try {
    await handleCommand(interaction);
  } catch (error) {
    console.error(error);
    if (interaction.deferred || interaction.replied) await interaction.editReply(text.commandError).catch(() => {});
    else await interaction.reply({ content: text.commandError, ephemeral: true }).catch(() => {});
  }
});

client.login(config.discordToken);
