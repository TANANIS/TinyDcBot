export async function getWeather(location) {
  const query = String(location || "").trim();
  if (!query) throw new Error("Location is required.");

  const url = new URL(`https://wttr.in/${encodeURIComponent(query)}`);
  url.searchParams.set("format", "j1");

  const response = await fetch(url, {
    headers: { "User-Agent": "TinyDcBot/0.1 local personal bot" },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error(`Weather failed: HTTP ${response.status}`);

  const data = await response.json();
  const current = data.current_condition?.[0];
  const area = data.nearest_area?.[0];
  const forecast = data.weather?.[0];
  if (!current) throw new Error("Weather response was empty.");

  const place = [area?.areaName?.[0]?.value, area?.country?.[0]?.value].filter(Boolean).join(", ");
  const condition = current.weatherDesc?.[0]?.value || "unknown";
  const temp = current.temp_C;
  const feels = current.FeelsLikeC;
  const humidity = current.humidity;
  const chanceRain = forecast?.hourly?.[0]?.chanceofrain;

  return [
    `${place || query}: ${condition}`,
    `溫度 ${temp}°C，體感 ${feels}°C，濕度 ${humidity}%`,
    chanceRain != null ? `降雨機率 ${chanceRain}%` : "",
  ].filter(Boolean).join("\n");
}