import { createInitialState, jump, restartRunner, stepRunner } from "./gameLogic.js";

const canvas = document.querySelector("[data-canvas]");
const scoreEl = document.querySelector("[data-score]");
const statusEl = document.querySelector("[data-status]");
const restartBtn = document.querySelector("[data-restart]");
const jumpBtn = document.querySelector("[data-jump]");
const resultEl = document.querySelector("[data-result]");
const resultPlayerEl = document.querySelector("[data-result-player]");
const resultScoreEl = document.querySelector("[data-result-score]");
const resultTopEl = document.querySelector("[data-result-top]");
const telegramWebApp = window.Telegram?.WebApp;

const ctx = canvas.getContext("2d");
const DPR = Math.max(1, window.devicePixelRatio || 1);
const stateSize = { width: 360, height: 640 };

canvas.width = stateSize.width * DPR;
canvas.height = stateSize.height * DPR;
canvas.style.width = `${stateSize.width}px`;
canvas.style.height = `${stateSize.height}px`;
ctx.scale(DPR, DPR);

let state = createInitialState(stateSize);
let lastTs = 0;
let acc = 0;
const STEP_MS = 1000 / 60;
const GIRL_RENDER_SCALE = 1;

const params = new URLSearchParams(window.location.search);
const girlSrc = params.get("girl") || "./assets/girl.png";
const obstacleSrc = params.get("obstacle") || "./assets/obstacle.png";
const coinSrc = params.get("coin") || "./assets/logo.png";
const runFramePaths = [
  "./assets/frames/run/run_01.png",
  "./assets/frames/run/run_02.png",
  "./assets/frames/run/run_03.png",
  "./assets/frames/run/run_04.png",
  "./assets/frames/run/run_05.png",
  "./assets/frames/run/run_06.png"
];
const jumpFramePaths = [
  "./assets/frames/jump/jump_01.png",
  "./assets/frames/jump/jump_02.png",
  "./assets/frames/jump/jump_03.png",
  "./assets/frames/jump/jump_04.png",
  "./assets/frames/jump/jump_05.png",
  "./assets/frames/jump/jump_06.png"
];

const images = {
  girl: loadImage(girlSrc, { chromaKeyLightGray: true }),
  obstacle: loadImage(obstacleSrc),
  coin: loadImage(coinSrc)
};
const runFrames = runFramePaths.map((src) => loadImage(src, { chromaKeyLightGray: true }));
const jumpFrames = jumpFramePaths.map((src) => loadImage(src, { chromaKeyLightGray: true }));
let runAnimTimer = 0;
let runAnimIndex = 0;
const playerName = getPlayerName();
const initialTop = getTopFromQuery();
const playerId = getPlayerId();
let hasSubmittedRunnerScore = false;
const localBestKey = playerId ? `runner-best-${playerId}` : `runner-best-${playerName}`;

if (telegramWebApp) {
  telegramWebApp.ready();
  telegramWebApp.expand();
}

function loadImage(src, options = {}) {
  const image = new Image();
  let loaded = false;
  let drawable = image;
  let bounds = null;
  image.onload = () => {
    if (options.chromaKeyLightGray) {
      const off = document.createElement("canvas");
      off.width = image.naturalWidth;
      off.height = image.naturalHeight;
      const offCtx = off.getContext("2d");
      offCtx.drawImage(image, 0, 0);
      const frame = offCtx.getImageData(0, 0, off.width, off.height);
      const data = frame.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const isNearGray = Math.abs(r - g) < 8 && Math.abs(g - b) < 8;
        const isLight = r > 205 && g > 205 && b > 205;
        if (isNearGray && isLight) data[i + 3] = 0;
      }

      let minX = off.width;
      let minY = off.height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < off.height; y += 1) {
        for (let x = 0; x < off.width; x += 1) {
          const alpha = data[(y * off.width + x) * 4 + 3];
          if (alpha > 8) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
          }
        }
      }
      offCtx.putImageData(frame, 0, 0);
      drawable = off;
      if (maxX >= minX && maxY >= minY) {
        bounds = { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
      }
    }
    loaded = true;
  };
  image.onerror = () => {
    loaded = false;
  };
  image.src = src;
  return {
    image,
    drawable: () => drawable,
    bounds: () => bounds,
    isLoaded: () => loaded
  };
}

function getStableBounds(frames) {
  const withBounds = frames
    .map((f) => f.bounds?.())
    .filter((b) => b && b.sw > 0 && b.sh > 0);
  if (withBounds.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of withBounds) {
    if (b.sx < minX) minX = b.sx;
    if (b.sy < minY) minY = b.sy;
    if (b.sx + b.sw > maxX) maxX = b.sx + b.sw;
    if (b.sy + b.sh > maxY) maxY = b.sy + b.sh;
  }
  return { sx: minX, sy: minY, sw: maxX - minX, sh: maxY - minY };
}

function drawImageFit(frame, x, y, width, height, stableBounds = null) {
  const b = stableBounds || frame.bounds?.();
  if (b && b.sw > 0 && b.sh > 0) {
    ctx.drawImage(frame.drawable(), b.sx, b.sy, b.sw, b.sh, x, y, width, height);
    return;
  }
  ctx.drawImage(frame.drawable(), x, y, width, height);
}

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, state.height);
  grad.addColorStop(0, "#d5edff");
  grad.addColorStop(1, "#f7fff4");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, state.width, state.height);
}

function drawGround() {
  const y = state.height - state.groundHeight;
  ctx.fillStyle = "rgba(29, 55, 34, 0.85)";
  ctx.fillRect(0, y, state.width, state.groundHeight);
}

function drawGirl() {
  const g = state.girl;
  const groundY = state.height - state.groundHeight;
  const onGround = g.y + g.height >= groundY - 0.5;
  const renderWidth = Math.round(g.width * GIRL_RENDER_SCALE);
  const renderHeight = Math.round(g.height * GIRL_RENDER_SCALE);
  const renderX = Math.round(g.x - (renderWidth - g.width) / 2);
  const renderY = Math.round(g.y - (renderHeight - g.height));

  const loadedRunFrames = runFrames.filter((f) => f.isLoaded());
  const loadedJumpFrames = jumpFrames.filter((f) => f.isLoaded());
  const stableRunBounds = getStableBounds(loadedRunFrames);
  const stableJumpBounds = getStableBounds(loadedJumpFrames);
  let frame = null;
  let stableBounds = null;

  if (!onGround && loadedJumpFrames.length > 0) {
    const jumpIdx = g.velocityY < 0 ? Math.floor(loadedJumpFrames.length * 0.35) : Math.floor(loadedJumpFrames.length * 0.75);
    frame = loadedJumpFrames[Math.min(loadedJumpFrames.length - 1, Math.max(0, jumpIdx))];
    stableBounds = stableJumpBounds;
  } else if (loadedRunFrames.length > 0) {
    frame = loadedRunFrames[runAnimIndex % loadedRunFrames.length];
    stableBounds = stableRunBounds;
  } else if (images.girl.isLoaded()) {
    frame = images.girl;
  }

  if (frame?.isLoaded()) {
    drawImageFit(frame, renderX, renderY, renderWidth, renderHeight, stableBounds);
    return;
  }
  ctx.fillStyle = "#ff5f96";
  ctx.fillRect(renderX, renderY, renderWidth, renderHeight);
}

function drawObstacles() {
  const groundY = state.height - state.groundHeight;
  for (const obs of state.obstacles) {
    if (obs.kind === "pit") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(obs.x, groundY, obs.width, state.groundHeight);
      continue;
    }

    if (images.obstacle.isLoaded()) {
      ctx.drawImage(images.obstacle.image, obs.x, obs.y, obs.width, obs.height);
    } else {
      ctx.fillStyle = "#333";
      ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
    }
  }
}

function drawCoins() {
  for (const coin of state.coins) {
    if (images.coin.isLoaded()) {
      ctx.drawImage(images.coin.image, coin.x, coin.y, coin.width, coin.height);
      continue;
    }

    const x = coin.x + coin.width / 2;
    const y = coin.y + coin.height / 2;
    const radius = coin.width / 2;

    ctx.fillStyle = "#f7c948";
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function draw() {
  drawBackground();
  drawGround();
  drawObstacles();
  drawCoins();
  drawGirl();

  scoreEl.textContent = String(state.score);
  statusEl.textContent = state.isGameOver ? "Проигрыш" : "Игра";
  renderResultPanel();

  if (state.isGameOver) {
    ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
    ctx.fillRect(0, 0, state.width, state.height);

    const panelW = 290;
    const panelH = 360;
    const panelX = Math.round((state.width - panelW) / 2);
    const panelY = Math.round((state.height - panelH) / 2 - 6);
    ctx.fillStyle = "rgba(255, 255, 255, 0.95)";
    ctx.fillRect(panelX, panelY, panelW, panelH);
    ctx.strokeStyle = "rgba(35, 35, 35, 0.18)";
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelW, panelH);

    ctx.fillStyle = "#222";
    ctx.font = "700 30px 'Trebuchet MS', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Статистика", state.width / 2, panelY + 42);
    const storedBest = getStoredBest();
    const bestFromTop = findBestFromTop(initialTop, playerId, playerName, state.score);
    const bestOverall = Math.max(bestFromTop, storedBest, state.score);
    ctx.font = "600 20px 'Trebuchet MS', sans-serif";
    ctx.fillText(`Игрок: ${playerName}`, state.width / 2, panelY + 86);
    ctx.fillText(`Текущий: ${state.score}`, state.width / 2, panelY + 118);
    ctx.fillText(`Лучший: ${bestOverall}`, state.width / 2, panelY + 148);
    ctx.font = "700 18px 'Trebuchet MS', sans-serif";
    ctx.fillStyle = "#222";
    ctx.fillText("Топ-10 игроков", state.width / 2, panelY + 178);

    const liveTop = mergeCurrentPlayerIntoTop(initialTop, playerName, bestOverall, playerId);
    ctx.font = "500 12px 'Trebuchet MS', sans-serif";
    ctx.fillStyle = "#333";
    ctx.textAlign = "left";
    const listX = panelX + 18;
    const listStartY = panelY + 200;
    if (liveTop.length === 0) {
      ctx.fillText("Топ пока пуст", listX, listStartY);
    } else {
      const maxRows = 10;
      const rowHeight = 12;
      for (let i = 0; i < Math.min(maxRows, liveTop.length); i += 1) {
        const row = liveTop[i];
        const y = listStartY + i * rowHeight;
        const line = `${i + 1}. ${row.name} — ${row.score}`;
        ctx.fillText(line, listX, y);
      }
    }

    ctx.textAlign = "center";
    ctx.font = "500 16px 'Trebuchet MS', sans-serif";
    ctx.fillStyle = "#555";
    ctx.fillText("Нажми Рестарт", state.width / 2, panelY + panelH - 10);
    submitRunnerScore();
    storeBest(bestOverall);
  }
}

function getPlayerName() {
  const fromQuery = params.get("player");
  if (fromQuery) return fromQuery;
  const user = telegramWebApp?.initDataUnsafe?.user;
  if (!user) return "Игрок";
  if (user.username) return `@${user.username}`;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || "Игрок";
}

function tick(ts) {
  if (!lastTs) lastTs = ts;
  acc += ts - lastTs;
  lastTs = ts;

  while (acc >= STEP_MS) {
    if (!state.isGameOver) {
      state = stepRunner(state);
      runAnimTimer += STEP_MS;
      if (runAnimTimer >= 90) {
        runAnimTimer = 0;
        runAnimIndex += 1;
      }
    }
    acc -= STEP_MS;
  }

  draw();
  requestAnimationFrame(tick);
}

function doJump() {
  state = jump(state);
}

function doRestart() {
  state = restartRunner(state);
  hasSubmittedRunnerScore = false;
}

function renderResultPanel() {
  if (!resultEl || !resultPlayerEl || !resultScoreEl || !resultTopEl) return;
  resultEl.hidden = true;
}

function submitRunnerScore() {
  if (!telegramWebApp) return;
  if (hasSubmittedRunnerScore) return;
  const payload = { type: "runner_score", score: state.score, sentAt: Date.now() };
  telegramWebApp.sendData(JSON.stringify(payload));
  hasSubmittedRunnerScore = true;
}

function getStoredBest() {
  try {
    const raw = localStorage.getItem(localBestKey);
    const val = Number(raw);
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

function storeBest(score) {
  try {
    const current = getStoredBest();
    const next = Math.max(current, score);
    localStorage.setItem(localBestKey, String(next));
  } catch {
    // ignore storage failures
  }
}

function getTopFromQuery() {
  const raw = params.get("top");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        rank: Number(item.rank),
        userId: Number(item.userId),
        name: String(item.name || "Игрок"),
        score: Number(item.score || 0)
      }))
      .filter((item) => Number.isFinite(item.rank) && Number.isFinite(item.score))
      .slice(0, 10);
  } catch {
    return [];
  }
}

function getPlayerId() {
  const raw = params.get("playerId");
  if (!raw) return null;
  const id = Number(raw);
  return Number.isFinite(id) ? id : null;
}

function findBestFromTop(top, id, name, fallbackScore) {
  if (!Array.isArray(top) || top.length === 0) return fallbackScore;
  const byId = id ? top.find((row) => row.userId === id) : null;
  if (byId) return Math.max(byId.score, fallbackScore);
  const byName = top.find((row) => row.name === name);
  if (byName) return Math.max(byName.score, fallbackScore);
  return fallbackScore;
}

function mergeCurrentPlayerIntoTop(top, name, score, id) {
  const list = top.map((item) => ({ ...item }));
  const idx = id ? list.findIndex((item) => item.userId === id) : list.findIndex((item) => item.name === name);
  if (idx >= 0) {
    list[idx].score = Math.max(list[idx].score, score);
    list[idx].name = list[idx].name || name;
  } else {
    list.push({ rank: 999, name, score, userId: id || 0 });
  }
  return list
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 10);
}

document.addEventListener("keydown", (event) => {
  const key = event.key.toLowerCase();
  if (key === " " || key === "arrowup" || key === "w") {
    event.preventDefault();
    if (state.isGameOver) doRestart();
    else doJump();
  }
});

canvas.addEventListener("pointerdown", () => {
  if (state.isGameOver) doRestart();
  else doJump();
});

jumpBtn.addEventListener("click", doJump);
restartBtn.addEventListener("click", doRestart);

draw();
requestAnimationFrame(tick);
