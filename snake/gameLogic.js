export const DEFAULT_WIDTH = 20;
export const DEFAULT_HEIGHT = 20;
export const SHRINK_FOOD_TTL_TICKS_MIN = 22;
export const SHRINK_FOOD_TTL_TICKS_MAX = 36;

export const DIRECTIONS = {
  UP: { x: 0, y: -1 },
  DOWN: { x: 0, y: 1 },
  LEFT: { x: -1, y: 0 },
  RIGHT: { x: 1, y: 0 }
};

const OPPOSITES = {
  UP: "DOWN",
  DOWN: "UP",
  LEFT: "RIGHT",
  RIGHT: "LEFT"
};

function sameCell(a, b) {
  return a.x === b.x && a.y === b.y;
}

function randomFreeCell(width, height, snake, rng = Math.random) {
  const occupied = new Set(snake.map((cell) => `${cell.x},${cell.y}`));
  const free = [];

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = `${x},${y}`;
      if (!occupied.has(key)) free.push({ x, y });
    }
  }

  if (free.length === 0) return null;
  const idx = Math.floor(rng() * free.length);
  return free[idx];
}

function randomInt(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}

function getNextShrinkAt(rng = Math.random) {
  return rng() < 0.5 ? 3 : 4;
}

function spawnFood(width, height, snake, type, rng = Math.random) {
  const cell = randomFreeCell(width, height, snake, rng);
  if (!cell) return null;
  if (type === "SHRINK") {
    return {
      ...cell,
      type: "SHRINK",
      ttlTicks: randomInt(SHRINK_FOOD_TTL_TICKS_MIN, SHRINK_FOOD_TTL_TICKS_MAX, rng)
    };
  }
  return { ...cell, type: "GROW" };
}

function normalizeFoodCounters(state, rng = Math.random) {
  return {
    foodSpawnCounter: Number.isFinite(state.foodSpawnCounter) ? state.foodSpawnCounter : 0,
    nextShrinkAt: Number.isFinite(state.nextShrinkAt) ? state.nextShrinkAt : getNextShrinkAt(rng)
  };
}

function spawnNextFoodByCycle(state, snake, rng = Math.random) {
  const counters = normalizeFoodCounters(state, rng);
  let nextCounter = counters.foodSpawnCounter + 1;
  let nextShrinkAt = counters.nextShrinkAt;
  let type = "GROW";

  if (nextCounter >= nextShrinkAt) {
    type = "SHRINK";
    nextCounter = 0;
    nextShrinkAt = getNextShrinkAt(rng);
  }

  return {
    food: spawnFood(state.width, state.height, snake, type, rng),
    foodSpawnCounter: nextCounter,
    nextShrinkAt
  };
}

export function createInitialState({
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  rng = Math.random
} = {}) {
  const head = { x: Math.floor(width / 2), y: Math.floor(height / 2) };
  const snake = [head];
  const nextShrinkAt = getNextShrinkAt(rng);

  return {
    width,
    height,
    snake,
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: spawnFood(width, height, snake, "GROW", rng),
    foodSpawnCounter: 1,
    nextShrinkAt,
    score: 0,
    isGameOver: false,
    didGrowOnLastStep: false
  };
}

export function setDirection(state, direction) {
  if (!DIRECTIONS[direction]) return state;
  if (OPPOSITES[state.direction] === direction) return state;
  if (OPPOSITES[state.nextDirection] === direction) return state;
  return { ...state, nextDirection: direction };
}

export function restartGame(state, rng = Math.random) {
  return createInitialState({ width: state.width, height: state.height, rng });
}

export function stepGame(state, rng = Math.random) {
  if (state.isGameOver) return state;

  const direction = state.nextDirection;
  const vector = DIRECTIONS[direction];
  const currentHead = state.snake[0];
  const newHead = {
    x: (currentHead.x + vector.x + state.width) % state.width,
    y: (currentHead.y + vector.y + state.height) % state.height
  };

  const foodType = state.food && sameCell(newHead, state.food) ? state.food.type || "GROW" : null;
  const grows = foodType === "GROW";
  const shrinks = foodType === "SHRINK";
  const bodyToCheck = grows ? state.snake : state.snake.slice(0, -1);
  const hitsSelf = bodyToCheck.some((cell) => sameCell(cell, newHead));
  if (hitsSelf) {
    return { ...state, direction, isGameOver: true, didGrowOnLastStep: false };
  }

  const nextSnake = [newHead, ...state.snake];
  if (!grows) nextSnake.pop();
  if (shrinks && nextSnake.length > 1) nextSnake.pop();

  const counters = normalizeFoodCounters(state, rng);
  let nextFood = state.food;
  let nextCounters = counters;

  if (foodType) {
    const spawned = spawnNextFoodByCycle(state, nextSnake, rng);
    nextFood = spawned.food;
    nextCounters = {
      foodSpawnCounter: spawned.foodSpawnCounter,
      nextShrinkAt: spawned.nextShrinkAt
    };
  } else if (state.food?.type === "SHRINK") {
    const ttlTicks = Number.isFinite(state.food.ttlTicks) ? state.food.ttlTicks : SHRINK_FOOD_TTL_TICKS_MAX;
    if (ttlTicks <= 1) {
      nextFood = spawnFood(state.width, state.height, nextSnake, "GROW", rng);
    } else {
      nextFood = { ...state.food, ttlTicks: ttlTicks - 1 };
    }
  }

  return {
    ...state,
    direction,
    snake: nextSnake,
    food: nextFood,
    foodSpawnCounter: nextCounters.foodSpawnCounter,
    nextShrinkAt: nextCounters.nextShrinkAt,
    score: Math.max(0, state.score + (grows ? 1 : 0) - (shrinks ? 1 : 0)),
    isGameOver: false,
    didGrowOnLastStep: grows
  };
}
