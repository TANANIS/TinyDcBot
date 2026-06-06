import { config } from "./config.js";
import { chatOllama, isOllamaResourceError } from "./ollamaApi.js";
import { buildPrompt, coerceReplyForUserMessage, getReplyNumPredict } from "./promptMemory.js";

export async function askOllama(userText, promptContext = {}, memoryText = userText) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

  try {
    const prompt = buildPrompt(userText, { ...promptContext, rawUserMessage: memoryText });
    const data = await chatOllama({
      signal: controller.signal,
      numPredict: getReplyNumPredict(memoryText, config.ollamaNumPredict),
      messages: [{ role: "user", content: prompt }],
    });

    const content = data?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new Error("Ollama returned an empty final response.");
    }

    return coerceReplyForUserMessage(memoryText, content.trim());
  } catch (error) {
    if (error?.message === "MODEL_GPU_BUSY" || error?.message === "MODEL_GPU_REQUIRED") {
      throw error;
    }

    if (isOllamaResourceError(`${error.body || ""}\n${error.message || ""}`)) {
      throw new Error("MODEL_RESOURCE_LIMIT");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
