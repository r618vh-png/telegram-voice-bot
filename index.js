import dotenv from "dotenv";
import { promises as fsp } from "node:fs";
import path from "node:path";
import process from "node:process";
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
  RUNNER_WEBAPP_URL = ""
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
const economyMode = ECONOMY_MODE !== "false";
const maxAnswerChars = Number(ECONOMY_MAX_ANSWER_CHARS) > 0 ? Number(ECONOMY_MAX_ANSWER_CHARS) : 180;
const runnerWebAppUrl = String(RUNNER_WEBAPP_URL || "").trim();

await fsp.mkdir(tmpDir, { recursive: true });
await fsp.mkdir(dataDir, { recursive: true });

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
  const joiner = url.includes("?") ? "&" : "?";
  return `${url}${joiner}top=${encodeURIComponent(JSON.stringify(top))}&ts=${Date.now()}`;
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

function renderRunnerLeaderboardText(leaderboard, limit = 10) {
  const top = getTopEntries(leaderboard, limit);
  if (top.length === 0) {
    return "Runner таблица рекордов пока пустая.\nСыграй в /runner.";
  }
  const lines = top.map((entry, idx) => `${idx + 1}. ${entry.displayName} (id:${entry.userId}) — ${entry.bestScore}`);
  return `Runner: топ-${Math.min(limit, top.length)}\n${lines.join("\n")}`;
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
});

bot.onText(/\/toprunner100/, async (msg) => {
  const leaderboard = await readRunnerLeaderboard();
  await bot.sendMessage(msg.chat.id, renderRunnerLeaderboardText(leaderboard, 100));
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

        const updatedRunnerUrl = getRunnerUrlWithTopAndPlayer(result.leaderboard, msg.from || {});
        const updatedRunnerMarkup = updatedRunnerUrl ? getRunnerButtonMarkupByUrl(updatedRunnerUrl) : null;

        const recordLine = result.isNewRecord
          ? `Новый рекорд Runner: ${result.bestScore}.`
          : `Твой лучший рекорд Runner уже выше: ${result.bestScore}.`;
        await bot.sendMessage(
          chatId,
          `Runner результат принят: ${score}\n${recordLine}\nТвоё место в Runner: #${result.rank}\nПосмотреть топ: /toprunner\nОткрыть Runner с обновлённым топом:`,
          updatedRunnerMarkup ? { reply_markup: updatedRunnerMarkup } : undefined
        );
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
