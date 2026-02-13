import dotenv from "dotenv";
import fs, { promises as fsp } from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import http from "node:http";
import TelegramBot from "node-telegram-bot-api";
import { GoogleGenAI } from "@google/genai";
import { createEmptyLeaderboard, getTopEntries, normalizeScore, upsertBestScore } from "./snake/leaderboard.js";

dotenv.config({ override: true });

const {
  TELEGRAM_BOT_TOKEN,
  GEMINI_API_KEY,
  GEMINI_MODEL = "gemini-2.5-flash",
  GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts",
  GEMINI_TTS_VOICE = "Kore",
  ECONOMY_MODE = "true",
  ECONOMY_MAX_ANSWER_CHARS = "180",
  RUNNER_WEBAPP_URL = "",
  RUNNER_SCORE_API_URL = "",
  RUNNER_SCORE_PORT = "8080"
} = process.env;

if (!TELEGRAM_BOT_TOKEN || !GEMINI_API_KEY) {
  console.error("Missing TELEGRAM_BOT_TOKEN or GEMINI_API_KEY in .env");
  process.exit(1);
}

const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
const tmpDir = path.resolve("tmp");
const dataDir = path.resolve("data");
const runnerLeaderboardPath = path.join(dataDir, "runner-leaderboard.json");
const runnerOfferPath = path.join(dataDir, "runner-offer.json");
const adminPath = path.join(dataDir, "admins.json");
const economyMode = ECONOMY_MODE !== "false";
const maxAnswerChars = Number(ECONOMY_MAX_ANSWER_CHARS) > 0 ? Number(ECONOMY_MAX_ANSWER_CHARS) : 180;
const runnerWebAppUrl = String(RUNNER_WEBAPP_URL || "").trim();
const runnerScoreApiUrl = String(RUNNER_SCORE_API_URL || "").trim();
const runnerScorePort = Number(RUNNER_SCORE_PORT) || 8080;
let adminIds = new Set([621327376]);
const offerDrafts = new Map();
const OFFER_SLOTS = 5;

await fsp.mkdir(tmpDir, { recursive: true });
await fsp.mkdir(dataDir, { recursive: true });
await loadAdmins();
startRunnerScoreServer();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isQuotaError = (error) => {
  const msg = String(error?.message || "");
  return msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("quota");
};

function decodeBase64Audio(base64Data) {
  return Buffer.from(base64Data, "base64");
}

function pcmToWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  pcmBuffer.copy(buffer, 44);
  return buffer;
}

async function withRetries(taskName, fn, maxAttempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (isQuotaError(error)) break;
      if (attempt < maxAttempts) await sleep(700 * attempt);
    }
  }
  throw new Error(`${taskName}: ${lastError?.message || "unknown error"}`);
}

function trimForEconomy(text) {
  const clean = String(text || "").trim();
  if (!economyMode || clean.length <= maxAnswerChars) return clean;
  return `${clean.slice(0, maxAnswerChars - 1)}...`;
}

function getRunnerButtonMarkupByUrl(url) {
  if (!url) return null;
  return {
    keyboard: [
      [
        {
          text: "Играть в Runner",
          web_app: { url }
        }
      ]
    ],
    resize_keyboard: true,
    one_time_keyboard: true
  };
}

function getRunnerUrlWithPlayer(user = {}) {
  if (!runnerWebAppUrl) return "";
  const username = user?.username ? `@${user.username}` : "";
  const fullName = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
  const player = username || fullName || "";
  const playerId = Number(user?.id) ? String(user.id) : "";
  const joiner = runnerWebAppUrl.includes("?") ? "&" : "?";
  if (!player && !playerId) return runnerWebAppUrl;
  const params = new URLSearchParams();
  if (player) params.set("player", player);
  if (playerId) params.set("playerId", playerId);
  return `${runnerWebAppUrl}${joiner}${params.toString()}`;
}

function getRunnerUrlWithTopAndPlayer(leaderboard, user = {}) {
  let url = getRunnerUrlWithPlayer(user);
  if (!url) return "";
  const top = getTopEntries(leaderboard, 10).map((entry, idx) => ({
    rank: idx + 1,
    userId: entry.userId,
    name: entry.displayName,
    score: entry.bestScore
  }));
  const playerId = Number(user?.id);
  const playerEntry = Array.isArray(leaderboard?.entries)
    ? leaderboard.entries.find((entry) => entry.userId === playerId)
    : null;
  const playerBest = playerEntry ? Number(playerEntry.bestScore) : null;
  const joiner = url.includes("?") ? "&" : "?";
  const bestParam = Number.isFinite(playerBest) ? `&best=${playerBest}` : "";
  const apiParam = runnerScoreApiUrl ? `&api=${encodeURIComponent(runnerScoreApiUrl)}` : "";
  return `${url}${joiner}top=${encodeURIComponent(JSON.stringify(top))}${bestParam}${apiParam}&ts=${Date.now()}`;
}

function getGamesChoiceKeyboard() {
  return {
    keyboard: [[{ text: "Runner" }]],
    resize_keyboard: true
  };
}

async function readRunnerLeaderboard() {
  try {
    const raw = await fsp.readFile(runnerLeaderboardPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.entries)) return createEmptyLeaderboard();
    return {
      version: 1,
      updatedAt: String(parsed.updatedAt || new Date(0).toISOString()),
      entries: parsed.entries
    };
  } catch (error) {
    if (error?.code === "ENOENT") return createEmptyLeaderboard();
    throw error;
  }
}

async function writeRunnerLeaderboard(leaderboard) {
  await fsp.writeFile(runnerLeaderboardPath, JSON.stringify(leaderboard, null, 2), "utf8");
}

async function loadAdmins() {
  try {
    const raw = await fsp.readFile(adminPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.ids)) {
      adminIds = new Set(parsed.ids.map((id) => Number(id)).filter((id) => Number.isFinite(id)));
      if (adminIds.size === 0) adminIds.add(621327376);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") console.error("Failed to load admins:", error);
  }
}

async function saveAdmins() {
  const ids = Array.from(adminIds).filter((id) => Number.isFinite(id));
  await fsp.writeFile(adminPath, JSON.stringify({ ids }, null, 2), "utf8");
}

function normalizeOfferSlot(value) {
  const slot = Number(value);
  if (!Number.isFinite(slot)) return null;
  if (slot < 1 || slot > OFFER_SLOTS) return null;
  return slot;
}

function getRunnerOfferData() {
  try {
    const raw = fs.readFileSync(runnerOfferPath, "utf8");
    const parsed = JSON.parse(raw);
    const offers = Array.isArray(parsed?.offers) ? parsed.offers : [];
    const normalized = [];
    for (let i = 0; i < OFFER_SLOTS; i += 1) {
      const offer = offers[i] && typeof offers[i] === "object" ? offers[i] : {};
      const text = String(offer.text || "").trim();
      const image = offer.image && typeof offer.image === "object" ? offer.image : null;
      normalized.push({
        text,
        image: image && typeof image.value === "string" ? image : null
      });
    }
    return { offers: normalized };
  } catch {
    return { offers: Array.from({ length: OFFER_SLOTS }, () => ({ text: "", image: null })) };
  }
}

function getOfferBySlot(slot) {
  const data = getRunnerOfferData();
  const idx = slot - 1;
  return data.offers[idx] || { text: "", image: null };
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function verifyTelegramInitData(initData, botToken) {
  if (!initData || !botToken) return { ok: false, reason: "missing_init_data" };
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "missing_hash" };
  params.delete("hash");
  const pairs = [];
  for (const [key, value] of params.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");
  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (computed !== hash) return { ok: false, reason: "invalid_hash" };
  return { ok: true, params };
}

async function setRunnerOfferText(slot, text) {
  const data = getRunnerOfferData();
  const idx = slot - 1;
  const offer = data.offers[idx] || { text: "", image: null };
  data.offers[idx] = { ...offer, text: String(text || "").trim() };
  await fsp.writeFile(
    runnerOfferPath,
    JSON.stringify({ offers: data.offers, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

async function setRunnerOfferImage(slot, image) {
  const data = getRunnerOfferData();
  const idx = slot - 1;
  const offer = data.offers[idx] || { text: "", image: null };
  data.offers[idx] = { ...offer, image: image || null };
  await fsp.writeFile(
    runnerOfferPath,
    JSON.stringify({ offers: data.offers, updatedAt: new Date().toISOString() }, null, 2),
    "utf8"
  );
}

function isAdmin(msg) {
  const id = Number(msg?.from?.id);
  return Number.isFinite(id) && adminIds.has(id);
}

function getDraft(chatId) {
  return offerDrafts.get(chatId) || null;
}

function setDraft(chatId, draft) {
  offerDrafts.set(chatId, draft);
}

function clearDraft(chatId) {
  offerDrafts.delete(chatId);
}

function buildOfferPreviewText() {
  return [
    "Пример результата после игры:",
    "Ваш результат: 12",
    "Ваш новый рекорд: 12.",
    "Твоё место в Runner: #1",
    "Посмотреть топ: /toprunner"
  ].join("\n");
}

function renderRunnerLeaderboardText(leaderboard, limit = 10) {
  const top = getTopEntries(leaderboard, limit);
  if (top.length === 0) {
    return "Runner таблица рекордов пока пустая.\nСыграй в /runner.";
  }
  const lines = top.map((entry, idx) => `${idx + 1}. ${entry.displayName} (id:${entry.userId}) — ${entry.bestScore}`);
  return `Runner: топ-${Math.min(limit, top.length)}\n${lines.join("\n")}`;
}

function startRunnerScoreServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://localhost");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/runner-score") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found" }));
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", async () => {
      try {
        const payload = JSON.parse(body || "{}");
        const score = normalizeScore(payload.score);
        const initData = String(payload.initData || "");
        if (score === null) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: "invalid_score" }));
          return;
        }
        const verified = verifyTelegramInitData(initData, TELEGRAM_BOT_TOKEN);
        if (!verified.ok) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: false, error: verified.reason }));
          return;
        }
        const params = verified.params;
        const userRaw = params.get("user") || "{}";
        let user;
        try {
          user = JSON.parse(userRaw);
        } catch {
          user = {};
        }
        const leaderboard = await readRunnerLeaderboard();
        const result = upsertBestScore(leaderboard, user, score);
        await writeRunnerLeaderboard(result.leaderboard);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, rank: result.rank, bestScore: result.bestScore }));
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "server_error" }));
      }
    });
  });

  server.listen(runnerScorePort, "0.0.0.0", () => {
    console.log(`Runner score server listening on ${runnerScorePort}`);
  });
}

async function transcribeAndAnswer(audioBuffer) {
  const audioPart = {
    inlineData: {
      mimeType: "audio/ogg",
      data: audioBuffer.toString("base64")
    }
  };

  const prompt = `Сделай 2 шага: 1) распознай речь из аудио, 2) дай очень краткий дружелюбный ответ на русском (1-2 коротких предложения).
Верни только JSON без markdown в формате {"transcript":"...","answer":"..."}.`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [audioPart, { text: prompt }] }],
    config: { responseMimeType: "application/json" }
  });

  const rawText = response.text?.trim() || "{}";
  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Gemini вернул невалидный JSON");
  }

  return {
    transcript: String(parsed.transcript || "").trim(),
    answer: String(parsed.answer || "").trim()
  };
}

async function synthesizeSpeech(text) {
  const response = await ai.models.generateContent({
    model: GEMINI_TTS_MODEL,
    contents: [{ role: "user", parts: [{ text }] }],
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: GEMINI_TTS_VOICE }
        }
      }
    }
  });

  const part = response.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data);
  const base64Audio = part?.inlineData?.data;
  const mimeType = part?.inlineData?.mimeType || "audio/pcm;rate=24000";

  if (!base64Audio) {
    throw new Error("Не удалось получить аудио от Gemini TTS");
  }

  const pcm = decodeBase64Audio(base64Audio);
  const sampleRateMatch = mimeType.match(/rate=(\d+)/);
  const sampleRate = sampleRateMatch ? Number(sampleRateMatch[1]) : 24000;
  return pcmToWav(pcm, sampleRate, 1, 16);
}

async function answerTextOnly(userText) {
  const prompt = economyMode
    ? `Ответь кратко и дружелюбно на русском. Лимит: ${maxAnswerChars} символов. Вопрос: ${userText}`
    : `Ответь дружелюбно на русском. Вопрос: ${userText}`;
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: "user", parts: [{ text: prompt }] }]
  });
  return trimForEconomy(response.text || "");
}

bot.onText(/\/start/, async (msg) => {
  const text = "Выбери игру кнопками ниже или командами: /runner, /toprunner, /toprunner100";
  const keyboard = getGamesChoiceKeyboard();
  await bot.sendMessage(msg.chat.id, text, keyboard ? { reply_markup: keyboard } : undefined);
});

async function sendRunnerLaunch(msg) {
  const chatId = msg.chat.id;
  if (!runnerWebAppUrl) {
    await bot.sendMessage(
      chatId,
      "Runner пока не подключен. Добавь RUNNER_WEBAPP_URL (https-ссылка на игру) в .env и перезапусти бота."
    );
    return;
  }

  if (!/^https:\/\//i.test(runnerWebAppUrl)) {
    await bot.sendMessage(
      chatId,
      "RUNNER_WEBAPP_URL должен начинаться с https://, иначе Telegram Mini App не откроется."
    );
    return;
  }

  const leaderboard = await readRunnerLeaderboard();
  const runnerUrl = getRunnerUrlWithTopAndPlayer(leaderboard, msg.from || {});
  await bot.sendMessage(chatId, "Открывай Runner:", {
    reply_markup: getRunnerButtonMarkupByUrl(runnerUrl)
  });
}

bot.onText(/\/runner/, async (msg) => {
  await sendRunnerLaunch(msg);
});

bot.onText(/^Runner$/i, async (msg) => {
  await sendRunnerLaunch(msg);
});

bot.onText(/\/toprunner/, async (msg) => {
  const leaderboard = await readRunnerLeaderboard();
  await bot.sendMessage(msg.chat.id, renderRunnerLeaderboardText(leaderboard, 10));
  const offerData = getRunnerOfferData();
  const offerText = offerData.text;
  const offerHtml = offerText ? `<b>${escapeHtml(offerText)}</b>` : "";
  if (offerData.image?.value) {
    const photo = offerData.image.value;
    if (offerHtml) {
      await bot.sendPhoto(msg.chat.id, photo, { caption: offerHtml, parse_mode: "HTML" });
    } else {
      await bot.sendPhoto(msg.chat.id, photo);
    }
  } else if (offerHtml) {
    await bot.sendMessage(msg.chat.id, offerHtml, { parse_mode: "HTML" });
  }
});

bot.onText(/\/toprunner100/, async (msg) => {
  const leaderboard = await readRunnerLeaderboard();
  await bot.sendMessage(msg.chat.id, renderRunnerLeaderboardText(leaderboard, 100));
  const offerData = getRunnerOfferData();
  const offerText = offerData.text;
  const offerHtml = offerText ? `<b>${escapeHtml(offerText)}</b>` : "";
  if (offerData.image?.value) {
    const photo = offerData.image.value;
    if (offerHtml) {
      await bot.sendPhoto(msg.chat.id, photo, { caption: offerHtml, parse_mode: "HTML" });
    } else {
      await bot.sendPhoto(msg.chat.id, photo);
    }
  } else if (offerHtml) {
    await bot.sendMessage(msg.chat.id, offerHtml, { parse_mode: "HTML" });
  }
});

bot.onText(/\/resetrunner/, async (msg) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Нет доступа к очистке результатов.");
    return;
  }
  const empty = createEmptyLeaderboard();
  await writeRunnerLeaderboard(empty);
  await bot.sendMessage(msg.chat.id, "Runner таблица рекордов очищена.");
});

bot.onText(/\/setoffer(?:\s+(\d+))?(?:\s+([\s\S]+))?/, async (msg, match) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Нет доступа к изменению предложения.");
    return;
  }
  const slot = normalizeOfferSlot(match?.[1]);
  const text = String(match?.[2] || "").trim();
  if (!slot || !text) {
    await bot.sendMessage(msg.chat.id, "Использование: /setoffer 1 Текст предложения (слот 1-5)");
    return;
  }
  await setRunnerOfferText(slot, text);
  await bot.sendMessage(msg.chat.id, `Текст предложения для слота ${slot} обновлён.`);
});

bot.onText(/\/setofferwizard(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Нет доступа к изменению предложения.");
    return;
  }
  const chatId = msg.chat.id;
  const slot = normalizeOfferSlot(match?.[1]);
  if (!slot) {
    await bot.sendMessage(chatId, "Использование: /setofferwizard 1 (слот 1-5)");
    return;
  }
  setDraft(chatId, { step: "await_text", slot, text: "", image: null });
  await bot.sendMessage(chatId, `Слот ${slot}. Отправь текст предложения.`);
});

bot.onText(/\/offer_skip/, async (msg) => {
  const chatId = msg.chat.id;
  const draft = getDraft(chatId);
  if (!draft || draft.step !== "await_image") return;
  draft.step = "preview";
  setDraft(chatId, draft);
  await sendOfferPreview(chatId, draft);
});

bot.onText(/\/setofferimg(?:\s+(\d+))?(?:\s+(https?:\/\/\S+))?/, async (msg, match) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Нет доступа к изменению картинки.");
    return;
  }
  const slot = normalizeOfferSlot(match?.[1]);
  const url = String(match?.[2] || "").trim();
  if (!slot || !url) {
    await bot.sendMessage(msg.chat.id, "Использование: /setofferimg 1 https://example.com/image.png (слот 1-5)");
    return;
  }
  await setRunnerOfferImage(slot, { type: "url", value: url });
  await bot.sendMessage(msg.chat.id, `Картинка предложения для слота ${slot} обновлена (URL).`);
});

bot.onText(/\/clearofferimg(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Нет доступа к изменению картинки.");
    return;
  }
  const slot = normalizeOfferSlot(match?.[1]);
  if (!slot) {
    await bot.sendMessage(msg.chat.id, "Использование: /clearofferimg 1 (слот 1-5)");
    return;
  }
  await setRunnerOfferImage(slot, null);
  await bot.sendMessage(msg.chat.id, `Картинка предложения для слота ${slot} удалена.`);
});

bot.on("photo", async (msg) => {
  if (!isAdmin(msg)) return;
  const caption = String(msg.caption || "").trim();
  if (!caption.startsWith("/setofferimg")) return;
  const parts = caption.split(/\s+/);
  const slot = normalizeOfferSlot(parts[1]);
  if (!slot) {
    await bot.sendMessage(msg.chat.id, "Использование: /setofferimg 1 (слот 1-5) и прикрепи фото.");
    return;
  }
  const sizes = Array.isArray(msg.photo) ? msg.photo : [];
  const last = sizes[sizes.length - 1];
  if (!last?.file_id) {
    await bot.sendMessage(msg.chat.id, "Не удалось получить фото. Попробуй ещё раз.");
    return;
  }
  await setRunnerOfferImage(slot, { type: "file_id", value: last.file_id });
  await bot.sendMessage(msg.chat.id, `Картинка предложения для слота ${slot} обновлена.`);
});

bot.onText(/\/addadmin(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Нет доступа к добавлению админа.");
    return;
  }
  const id = Number(match?.[1]);
  if (!Number.isFinite(id)) {
    await bot.sendMessage(msg.chat.id, "Использование: /addadmin 123456789");
    return;
  }
  adminIds.add(id);
  await saveAdmins();
  await bot.sendMessage(msg.chat.id, `Админ добавлен: ${id}`);
});

bot.onText(/\/deladmin(?:\s+(\d+))?/, async (msg, match) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Нет доступа к удалению админа.");
    return;
  }
  const id = Number(match?.[1]);
  if (!Number.isFinite(id)) {
    await bot.sendMessage(msg.chat.id, "Использование: /deladmin 123456789");
    return;
  }
  if (id === 621327376) {
    await bot.sendMessage(msg.chat.id, "Нельзя удалить главного админа.");
    return;
  }
  adminIds.delete(id);
  await saveAdmins();
  await bot.sendMessage(msg.chat.id, `Админ удалён: ${id}`);
});

bot.onText(/\/listoffers/, async (msg) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Нет доступа.");
    return;
  }
  const { offers } = getRunnerOfferData();
  const lines = offers.map((offer, idx) => {
    const hasText = offer.text ? "текст" : "—";
    const hasImage = offer.image?.value ? "картинка" : "—";
    return `${idx + 1}. ${hasText}, ${hasImage}`;
  });
  await bot.sendMessage(msg.chat.id, `Слоты предложений:\n${lines.join("\n")}`);
});

async function sendOfferPreview(chatId, draft) {
  const slot = draft?.slot || 1;
  const text = String(draft?.text || "").trim();
  const image = draft?.image || null;
  const title = `Предложение ${slot}/5`;
  if (image?.value) {
    const caption = text ? `<b>${escapeHtml(title)}</b>\n${escapeHtml(text)}` : `<b>${escapeHtml(title)}</b>`;
    await bot.sendPhoto(chatId, image.value, { caption, parse_mode: "HTML" });
  } else if (text) {
    await bot.sendMessage(chatId, `<b>${escapeHtml(title)}</b>\n${escapeHtml(text)}`, { parse_mode: "HTML" });
  } else {
    await bot.sendMessage(chatId, `<b>${escapeHtml(title)}</b>`, { parse_mode: "HTML" });
  }

  const previewText = buildOfferPreviewText();
  const keyboard = {
    inline_keyboard: [
      [
        { text: "Сохранить", callback_data: "offer_save" },
        { text: "Отправить другие", callback_data: "offer_restart" }
      ]
    ]
  };
  await bot.sendMessage(chatId, previewText, { reply_markup: keyboard });
}

bot.on("callback_query", async (query) => {
  const chatId = query.message?.chat?.id;
  if (!chatId) return;
  const draft = getDraft(chatId);
  if (!draft) return;
  if (!isAdmin({ from: query.from })) {
    await bot.answerCallbackQuery(query.id, { text: "Нет доступа." });
    return;
  }
  if (query.data === "offer_save") {
    await setRunnerOfferText(draft.text);
    await setRunnerOfferImage(draft.image || null);
    clearDraft(chatId);
    await bot.answerCallbackQuery(query.id, { text: "Сохранено." });
    await bot.sendMessage(chatId, "Предложение сохранено.");
    return;
  }
  if (query.data === "offer_restart") {
    setDraft(chatId, { step: "await_text", text: "", image: null });
    await bot.answerCallbackQuery(query.id, { text: "Ок." });
    await bot.sendMessage(chatId, "Отправь новый текст предложения.");
  }
});

bot.on("polling_error", (error) => {
  console.error("Polling error:", error?.message || error);
});

bot.on("message", async (msg) => {
  console.log(
    "Incoming message:",
    JSON.stringify({
      chatId: msg.chat?.id,
      hasVoice: Boolean(msg.voice),
      hasText: Boolean(msg.text),
      hasWebAppData: Boolean(msg.web_app_data?.data)
    })
  );

  if (msg.text?.startsWith("/")) return;

  const chatId = msg.chat.id;

  if (msg.web_app_data?.data) {
    try {
      const payload = JSON.parse(msg.web_app_data.data);
      if (payload?.type === "runner_score") {
        const score = normalizeScore(payload.score);
        if (score === null) {
          await bot.sendMessage(chatId, "Некорректный счёт Runner. Попробуй отправить результат ещё раз.");
          return;
        }

        const leaderboard = await readRunnerLeaderboard();
        const result = upsertBestScore(leaderboard, msg.from || {}, score);
        await writeRunnerLeaderboard(result.leaderboard);

        const recordLine = result.isNewRecord
          ? `Ваш новый рекорд: ${result.bestScore}.`
          : `Ваш рекорд: ${result.bestScore}.`;
        const { offers } = getRunnerOfferData();
        for (let i = 0; i < offers.length; i += 1) {
          const offer = offers[i];
          const offerText = offer?.text || "";
          const title = `Предложение ${i + 1}/5`;
          const body = offerText ? `<b>${escapeHtml(title)}</b>\n${escapeHtml(offerText)}` : `<b>${escapeHtml(title)}</b>`;
          const photo = offer?.image?.value || "";
          if (photo) {
            await bot.sendPhoto(chatId, photo, { caption: body, parse_mode: "HTML" });
          } else if (offerText) {
            await bot.sendMessage(chatId, body, { parse_mode: "HTML" });
          }
        }

        const resultText = `Ваш результат: ${score}\n${recordLine}\nТвоё место в Runner: #${result.rank}\nПосмотреть топ: /toprunner\n<b>Играть еще: /runner</b>`;
        await bot.sendMessage(chatId, resultText, { parse_mode: "HTML" });
        return;
      }

      {
        await bot.sendMessage(chatId, "Неизвестный формат данных из мини-игры.");
        return;
      }
    } catch (error) {
      console.error("Snake score handling error:", error);
      await bot.sendMessage(chatId, "Не удалось обработать результат игры.");
    }
    return;
  }

  const draft = getDraft(chatId);
  if (draft) {
    if (draft.step === "await_text" && msg.text) {
      draft.text = msg.text.trim();
      draft.step = "await_image";
      setDraft(chatId, draft);
      await bot.sendMessage(chatId, `Слот ${draft.slot}. Теперь отправь картинку или напиши /offer_skip чтобы пропустить.`);
      return;
    }
    if (draft.step === "await_image" && msg.photo) {
      const sizes = Array.isArray(msg.photo) ? msg.photo : [];
      const last = sizes[sizes.length - 1];
      if (last?.file_id) {
        draft.image = { type: "file_id", value: last.file_id };
      }
      draft.step = "preview";
      setDraft(chatId, draft);
      await sendOfferPreview(chatId, draft);
      return;
    }
    if (draft.step === "await_image" && msg.text) {
      await bot.sendMessage(chatId, "Жду картинку. Если без картинки, напиши /offer_skip.");
      return;
    }
  }

  if (msg.text) {
    const textReply = await withRetries("Gemini текст", async () => answerTextOnly(msg.text));
    await bot.sendMessage(chatId, textReply || "Не смог ответить, попробуй еще раз.");
    return;
  }

  if (!msg.voice) {
    await bot.sendMessage(chatId, "Отправь текст или голосовое сообщение.");
    return;
  }

  const uid = `${chatId}-${Date.now()}`;
  const outPath = path.join(tmpDir, `${uid}.wav`);

  try {
    await bot.sendChatAction(chatId, "record_voice");

    const fileLink = await bot.getFileLink(msg.voice.file_id);
    const audioRes = await fetch(fileLink);
    if (!audioRes.ok) {
      throw new Error(`Не удалось скачать voice: ${audioRes.status}`);
    }

    const audioBuffer = Buffer.from(await audioRes.arrayBuffer());

    const { transcript, answer } = await withRetries("Gemini обработка", async () =>
      transcribeAndAnswer(audioBuffer)
    );

    if (!transcript) {
      await bot.sendMessage(chatId, "Не расслышал, попробуй еще раз.");
      return;
    }

    const finalAnswer = trimForEconomy(answer || "Я услышал тебя, но не смог придумать ответ.");

    try {
      const wavBuffer = await withRetries("Gemini TTS", async () => synthesizeSpeech(finalAnswer));
      await fsp.writeFile(outPath, wavBuffer);
      await bot.sendAudio(chatId, outPath, { caption: `Ты сказал: ${transcript}` });
    } catch (ttsError) {
      if (isQuotaError(ttsError)) {
        await bot.sendMessage(
          chatId,
          `Лимит на озвучку исчерпан, отвечаю текстом.\nТы сказал: ${transcript}\nОтвет: ${finalAnswer}`
        );
      } else {
        throw ttsError;
      }
    }
  } catch (error) {
    console.error("Voice message handling error:", error);
    const details = String(error?.message || "unknown error").slice(0, 320);
    const hint = isQuotaError(error)
      ? "\nПревышена квота Gemini. Можно подождать сброс лимита или использовать текстовые сообщения."
      : "";
    await bot.sendMessage(chatId, `Ошибка при обработке: ${details}${hint}`);
  } finally {
    await fsp.rm(outPath, { force: true });
  }
});

process.on("SIGINT", () => {
  bot.stopPolling();
  process.exit(0);
});

console.log("Telegram voice bot is running...");
