import { createInitialState, restartGame, setDirection, stepGame } from "./gameLogic.js";

const BOARD_WIDTH = 8;
const BOARD_HEIGHT = 13;
const TICK_MS = 140;

const boardEl = document.querySelector("[data-board]");
const titleEl = document.querySelector("[data-title]");
const scoreEl = document.querySelector("[data-score]");
const statusEl = document.querySelector("[data-status]");
const restartBtn = document.querySelector("[data-restart]");
const pauseBtn = document.querySelector("[data-pause]");
const submitStatusEl = document.querySelector("[data-submit-status]");
const controlsEl = document.querySelector("[data-controls]");
const gameOverEl = document.querySelector("[data-game-over]");
const finalScoreEl = document.querySelector("[data-final-score]");
const youRankEl = document.querySelector("[data-you-rank]");
const topListEl = document.querySelector("[data-top-list]");
const playAgainBtn = document.querySelector("[data-play-again]");
const telegramWebApp = window.Telegram?.WebApp;

let state = createInitialState({ width: BOARD_WIDTH, height: BOARD_HEIGHT });
let isPaused = false;
let timer = null;
const initialTop = readTopFromQuery();
const initialYou = readYouFromQuery();
let swipeStartX = null;
let swipeStartY = null;

if (telegramWebApp) {
  telegramWebApp.ready();
  telegramWebApp.expand();
}
if (titleEl) titleEl.textContent = getPlayerTitle();

function render() {
  boardEl.innerHTML = "";
  boardEl.style.gridTemplateColumns = `repeat(${state.width}, 1fr)`;
  boardEl.style.gridTemplateRows = `repeat(${state.height}, 1fr)`;

  const snakeIndexByCell = new Map(
    state.snake.map((cell, index) => [`${cell.x},${cell.y}`, index])
  );

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";

      const key = `${x},${y}`;
      const segmentIndex = snakeIndexByCell.get(key);
      if (segmentIndex !== undefined) {
        cell.classList.add("snake");
        if (segmentIndex === 0) {
          cell.classList.add("head");
          cell.classList.add(`dir-${state.direction.toLowerCase()}`);
        } else if (segmentIndex === state.snake.length - 1) {
          cell.classList.add("tail");
        } else {
          cell.classList.add("body");
        }
      } else if (state.food && state.food.x === x && state.food.y === y) {
        cell.classList.add("food");
        cell.classList.add(state.food.type === "SHRINK" ? "food-shrink" : "food-grow");
      }

      boardEl.append(cell);
    }
  }

  scoreEl.textContent = String(state.score);
  if (state.isGameOver) {
    statusEl.textContent = "Проигрыш";
  } else if (isPaused) {
    statusEl.textContent = "Пауза";
  } else {
    statusEl.textContent = "Игра";
  }

  renderGameOverPanel();
}

function startLoop() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (isPaused || state.isGameOver) return;
    state = stepGame(state);
    render();
  }, TICK_MS);
}

function handleDirectionInput(direction) {
  state = setDirection(state, direction);
}

function keyToDirection(key) {
  const normalized = key.toLowerCase();
  if (normalized === "arrowup" || normalized === "w") return "UP";
  if (normalized === "arrowdown" || normalized === "s") return "DOWN";
  if (normalized === "arrowleft" || normalized === "a") return "LEFT";
  if (normalized === "arrowright" || normalized === "d") return "RIGHT";
  return null;
}

function togglePause() {
  if (state.isGameOver) return;
  isPaused = !isPaused;
  pauseBtn.textContent = isPaused ? "Продолжить" : "Пауза";
  render();
}

function resetGame() {
  state = restartGame(state);
  isPaused = false;
  submitStatusEl.textContent = "";
  pauseBtn.textContent = "Пауза";
  render();
}

function getPlayerTitle() {
  const user = telegramWebApp?.initDataUnsafe?.user;
  if (!user) return "Snake";
  if (user.username) return `@${user.username}`;
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return fullName || "Snake";
}

function readTopFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("top");
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => ({
        rank: Number(item.rank),
        name: String(item.name || "Unknown"),
        score: Number(item.score || 0)
      }))
      .filter((item) => Number.isFinite(item.rank) && Number.isFinite(item.score))
      .slice(0, 10);
  } catch {
    return [];
  }
}

function readYouFromQuery() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get("you");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const rank = Number(parsed.rank);
    const score = Number(parsed.score);
    if (!Number.isFinite(rank) || rank <= 0) return null;
    if (!Number.isFinite(score) || score < 0) return null;
    return { rank, score };
  } catch {
    return null;
  }
}

function renderGameOverPanel() {
  if (!gameOverEl || !finalScoreEl || !topListEl || !youRankEl) return;

  if (!state.isGameOver) {
    gameOverEl.hidden = true;
    topListEl.innerHTML = "";
    return;
  }

  gameOverEl.hidden = false;
  finalScoreEl.textContent = String(state.score);
  if (initialYou) {
    youRankEl.textContent = `Ты в рейтинге: #${initialYou.rank} (лучший: ${initialYou.score})`;
  } else {
    youRankEl.textContent = "Ты пока не в рейтинге";
  }

  const top = [...initialTop];
  if (top.length === 0) {
    topListEl.innerHTML = "<li>Пока нет данных. Используй /top в боте.</li>";
    submitStatusEl.textContent = "Для актуального рейтинга отправь /top в чате.";
    return;
  }

  topListEl.innerHTML = "";
  for (const entry of top) {
    const li = document.createElement("li");
    li.textContent = `${entry.rank}. ${entry.name} — ${entry.score}`;
    topListEl.append(li);
  }
  submitStatusEl.textContent = "Нажми «Еще раз» для новой игры.";
}

document.addEventListener("keydown", (event) => {
  const direction = keyToDirection(event.key);
  if (direction) {
    event.preventDefault();
    handleDirectionInput(direction);
    return;
  }

  if (event.key === " " || event.key.toLowerCase() === "p") {
    event.preventDefault();
    togglePause();
  }

  if (event.key.toLowerCase() === "r") {
    event.preventDefault();
    resetGame();
  }
});

controlsEl?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLButtonElement)) return;
  const direction = target.dataset.direction;
  if (direction) handleDirectionInput(direction);
});

restartBtn.addEventListener("click", resetGame);
pauseBtn.addEventListener("click", togglePause);
playAgainBtn?.addEventListener("click", resetGame);

function startSwipe(x, y) {
  swipeStartX = x;
  swipeStartY = y;
}

function endSwipe(x, y) {
  if (swipeStartX === null || swipeStartY === null) return;
  const dx = x - swipeStartX;
  const dy = y - swipeStartY;
  const absX = Math.abs(dx);
  const absY = Math.abs(dy);
  const SWIPE_THRESHOLD = 18;

  if (Math.max(absX, absY) >= SWIPE_THRESHOLD) {
    if (absX > absY) {
      handleDirectionInput(dx > 0 ? "RIGHT" : "LEFT");
    } else {
      handleDirectionInput(dy > 0 ? "DOWN" : "UP");
    }
  }

  swipeStartX = null;
  swipeStartY = null;
}

boardEl.addEventListener("pointerdown", (event) => {
  startSwipe(event.clientX, event.clientY);
});

window.addEventListener("pointerup", (event) => {
  endSwipe(event.clientX, event.clientY);
});

boardEl.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    startSwipe(touch.clientX, touch.clientY);
  },
  { passive: true }
);

boardEl.addEventListener(
  "touchmove",
  (event) => {
    event.preventDefault();
  },
  { passive: false }
);

window.addEventListener(
  "touchend",
  (event) => {
    const touch = event.changedTouches?.[0];
    if (!touch) return;
    endSwipe(touch.clientX, touch.clientY);
  },
  { passive: true }
);

render();
startLoop();
