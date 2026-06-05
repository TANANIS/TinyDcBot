import { config } from "./config.js";

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function extractDuckDuckGoResults(html) {
  const results = [];
  const blocks = html.match(/<div class="result[\s\S]*?<\/div>\s*<\/div>/g) || [];
  for (const block of blocks) {
    const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!titleMatch) continue;
    const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    const title = stripTags(titleMatch[2]);
    const url = decodeEntities(titleMatch[1]);
    const snippet = stripTags(snippetMatch?.[1] || snippetMatch?.[2] || "");
    if (title && url) results.push({ title, url, snippet });
    if (results.length >= config.searchMaxResults) break;
  }
  return results;
}

export function shouldSearch(message) {
  if (!config.allowWebSearch) return false;
  return String(message || "").trimStart().toLowerCase().startsWith(`${config.searchPrefix.toLowerCase()} `);
}

export function stripSearchPrefix(message) {
  const text = String(message || "").trimStart();
  return shouldSearch(text) ? text.slice(config.searchPrefix.length).trim() : text;
}

export async function webSearch(query) {
  if (!config.allowWebSearch) return [];
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery) return [];
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", cleanQuery);
  const response = await fetch(url, {
    headers: { "User-Agent": "TinyDcBot/0.1 local personal bot" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Search failed: HTTP ${response.status}`);
  return extractDuckDuckGoResults(await response.text());
}

export function formatSearchContext(results) {
  if (!results.length) return "";
  return [
    "【網路搜尋結果】",
    ...results.map((result, index) => [
      `${index + 1}. ${result.title}`,
      result.snippet ? `摘要：${result.snippet}` : "",
      `來源：${result.url}`,
    ].filter(Boolean).join("\n")),
  ].join("\n\n");
}