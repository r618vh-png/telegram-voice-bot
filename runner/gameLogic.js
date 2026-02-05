export const RUNNER_DEFAULTS = {
  width: 360,
  height: 640,
  groundHeight: 120,
  girlWidth: 92,
  girlHeight: 148,
  gravity: 0.62,
  jumpVelocity: -16.1,
  baseSpeed: 4.4
};

function randomInt(min, max, rng = Math.random) {
  return min + Math.floor(rng() * (max - min + 1));
}

function spawnBlockObstacle(state, rng = Math.random) {
  const height = randomInt(58, 120, rng);
  const width = randomInt(44, 70, rng);
  const groundY = state.height - state.groundHeight;
  return {
    kind: "block",
    x: state.width + randomInt(0, 40, rng),
    y: groundY - height,
    width,
    height,
    passed: false
  };
}

function spawnPit(state, rng = Math.random) {
  const width = randomInt(64, 128, rng);
  const groundY = state.height - state.groundHeight;
  return {
    kind: "pit",
    x: state.width + randomInt(0, 40, rng),
    y: groundY,
    width,
    height: state.groundHeight,
    passed: false
  };
}

function spawnHazard(state, rng = Math.random) {
  return rng() < 0.3 ? spawnPit(state, rng) : spawnBlockObstacle(state, rng);
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function canPlaceCoinAtX(x, size, obstacles) {
  const margin = 26;
  const coinStart = x - margin;
  const coinEnd = x + size + margin;
  for (const obs of obstacles) {
    if (rangesOverlap(coinStart, coinEnd, obs.x, obs.x + obs.width)) return false;
  }
  return true;
}

function spawnCoin(state, rng = Math.random) {
  const size = 44;
  const groundY = state.height - state.groundHeight;
  const topOffset = Math.round(state.girlHeight * 1.12 * 1.2);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const lane = randomInt(0, 1, rng);
    const yByLane = [
      groundY - Math.round(state.girlHeight * 0.6),
      groundY - topOffset
    ];
    const y = Math.max(24, yByLane[lane]);
    const x = state.width + randomInt(16, 90, rng);
    if (!canPlaceCoinAtX(x, size, state.obstacles)) continue;
    return {
      x,
      y,
      width: size,
      height: size
    };
  }

  return null;
}

export function createInitialState(overrides = {}, rng = Math.random) {
  const cfg = { ...RUNNER_DEFAULTS, ...overrides };
  const groundY = cfg.height - cfg.groundHeight;
  return {
    ...cfg,
    score: 0,
    isGameOver: false,
    isFallingIntoPit: false,
    ticks: 0,
    speed: cfg.baseSpeed,
    spawnIn: randomInt(70, 115, rng),
    coinSpawnIn: randomInt(30, 60, rng),
    girl: {
      x: 56,
      y: groundY - cfg.girlHeight,
      width: cfg.girlWidth,
      height: cfg.girlHeight,
      velocityY: 0
    },
    obstacles: [],
    coins: []
  };
}

export function restartRunner(state, rng = Math.random) {
  return createInitialState(
    {
      width: state.width,
      height: state.height,
      groundHeight: state.groundHeight,
      girlWidth: state.girlWidth,
      girlHeight: state.girlHeight
    },
    rng
  );
}

export function jump(state) {
  if (state.isGameOver) return state;
  if (state.isFallingIntoPit) return state;
  const groundY = state.height - state.groundHeight;
  const onGround = state.girl.y + state.girl.height >= groundY - 0.5;
  if (!onGround) return state;
  return {
    ...state,
    girl: {
      ...state.girl,
      velocityY: state.jumpVelocity
    }
  };
}

function intersects(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function stepRunner(state, rng = Math.random) {
  if (state.isGameOver) return state;

  const groundY = state.height - state.groundHeight;
  const nextTicks = state.ticks + 1;
  const nextSpeed = Math.min(9.5, state.baseSpeed + nextTicks * 0.0028);
  const isFallingIntoPit = Boolean(state.isFallingIntoPit);

  let girlY = state.girl.y + state.girl.velocityY;
  let velocityY = state.girl.velocityY + (isFallingIntoPit ? state.gravity * 1.4 : state.gravity);
  if (!isFallingIntoPit && girlY + state.girl.height >= groundY) {
    girlY = groundY - state.girl.height;
    velocityY = 0;
  }

  const moved = state.obstacles
    .map((obs) => ({ ...obs, x: obs.x - nextSpeed }))
    .filter((obs) => obs.x + obs.width > -8);
  const movedCoins = state.coins
    .map((coin) => ({ ...coin, x: coin.x - nextSpeed }))
    .filter((coin) => coin.x + coin.width > -8);

  let spawnIn = state.spawnIn - 1;
  if (spawnIn <= 0) {
    moved.push(spawnHazard(state, rng));
    spawnIn = randomInt(66, 112, rng);
  }
  let coinSpawnIn = state.coinSpawnIn - 1;
  if (coinSpawnIn <= 0) {
    const coin = spawnCoin({ ...state, obstacles: moved }, rng);
    if (coin) movedCoins.push(coin);
    coinSpawnIn = randomInt(26, 52, rng);
  }

  const girlBox = {
    x: state.girl.x + 20,
    y: girlY + 18,
    width: state.girl.width - 40,
    height: state.girl.height - 24
  };

  const onGround = girlY + state.girl.height >= groundY - 0.5;
  const hasPitCollision = moved.some((obs) => {
    if (obs.kind === "pit") {
      if (!onGround) return false;
      const footX = state.girl.x + 18;
      const footWidth = Math.max(8, state.girl.width - 36);
      return footX < obs.x + obs.width && footX + footWidth > obs.x;
    }
    return false;
  });

  if (hasPitCollision && !isFallingIntoPit) {
    return {
      ...state,
      ticks: nextTicks,
      speed: nextSpeed,
      spawnIn,
      coinSpawnIn,
      girl: { ...state.girl, y: girlY + 1, velocityY: Math.max(2.5, velocityY) },
      obstacles: moved,
      coins: movedCoins,
      isFallingIntoPit: true
    };
  }

  const hasBlockCollision = moved.some((obs) => {
    if (obs.kind === "pit") return false;
    return intersects(girlBox, obs);
  });
  if (hasBlockCollision) {
    return {
      ...state,
      ticks: nextTicks,
      speed: nextSpeed,
      girl: { ...state.girl, y: girlY, velocityY },
      obstacles: moved,
      coins: movedCoins,
      coinSpawnIn,
      isGameOver: true
    };
  }

  if (isFallingIntoPit && girlY > state.height + state.girl.height) {
    return {
      ...state,
      ticks: nextTicks,
      speed: nextSpeed,
      girl: { ...state.girl, y: girlY, velocityY },
      obstacles: moved,
      coins: movedCoins,
      spawnIn,
      coinSpawnIn,
      isGameOver: true
    };
  }

  let scoreAdd = 0;
  const nextCoins = [];
  for (const coin of movedCoins) {
    const blockedByObstacle = moved.some((obs) =>
      rangesOverlap(coin.x, coin.x + coin.width, obs.x, obs.x + obs.width)
    );
    if (blockedByObstacle) continue;
    if (intersects(girlBox, coin)) {
      scoreAdd += 1;
      continue;
    }
    nextCoins.push(coin);
  }

  const marked = moved.map((obs) => {
    if (!obs.passed && obs.x + obs.width < state.girl.x) return { ...obs, passed: true };
    return obs;
  });

  return {
    ...state,
    ticks: nextTicks,
    speed: nextSpeed,
    spawnIn,
    coinSpawnIn,
    score: state.score + scoreAdd,
    isFallingIntoPit,
    girl: { ...state.girl, y: girlY, velocityY },
    obstacles: marked,
    coins: nextCoins
  };
}
