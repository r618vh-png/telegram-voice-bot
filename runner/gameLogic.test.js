import test from "node:test";
import assert from "node:assert/strict";
import { createInitialState, jump, restartRunner, stepRunner } from "./gameLogic.js";

function fixedRng(value = 0) {
  return () => value;
}

test("jump changes vertical velocity when on ground", () => {
  const state = createInitialState({}, fixedRng(0));
  const next = jump(state);
  assert.ok(next.girl.velocityY < 0);
});

test("stepRunner eventually spawns obstacles", () => {
  let state = createInitialState({}, fixedRng(0));
  for (let i = 0; i < 140; i += 1) state = stepRunner(state, fixedRng(0));
  assert.ok(state.obstacles.length > 0);
});

test("collision leads to game over", () => {
  const state = {
    ...createInitialState({}, fixedRng(0)),
    obstacles: [{ x: 70, y: 430, width: 60, height: 100, passed: false }]
  };
  const next = stepRunner(state, fixedRng(0));
  assert.equal(next.isGameOver, true);
});

test("restart resets score and obstacles", () => {
  const state = {
    ...createInitialState({}, fixedRng(0)),
    score: 8,
    obstacles: [{ x: 120, y: 300, width: 44, height: 90, passed: false }]
  };
  const reset = restartRunner(state, fixedRng(0));
  assert.equal(reset.score, 0);
  assert.equal(reset.obstacles.length, 0);
});

test("collecting coin increases score and removes coin", () => {
  const base = createInitialState({}, fixedRng(0));
  const state = {
    ...base,
    score: 0,
    coins: [{ x: base.girl.x + 36, y: base.girl.y + 40, width: 22, height: 22 }],
    obstacles: [],
    spawnIn: 999,
    coinSpawnIn: 999
  };
  const next = stepRunner(state, fixedRng(0));
  assert.equal(next.score, 1);
  assert.equal(next.coins.length, 0);
});

test("score does not increase when passing obstacle without coin", () => {
  const base = createInitialState({}, fixedRng(0));
  const state = {
    ...base,
    score: 0,
    obstacles: [{ kind: "block", x: -80, y: 300, width: 60, height: 80, passed: false }],
    coins: [],
    spawnIn: 999,
    coinSpawnIn: 999
  };
  const next = stepRunner(state, fixedRng(0));
  assert.equal(next.score, 0);
});

test("coin does not spawn when obstacle occupies same jump window", () => {
  const base = createInitialState({}, fixedRng(0));
  const state = {
    ...base,
    obstacles: [{ kind: "block", x: 370, y: 300, width: 80, height: 100, passed: false }],
    coins: [],
    spawnIn: 999,
    coinSpawnIn: 0
  };
  const next = stepRunner(state, fixedRng(0));
  assert.equal(next.coins.length, 0);
});

test("pit starts falling state when runner is on ground over pit", () => {
  const base = createInitialState({}, fixedRng(0));
  const groundY = base.height - base.groundHeight;
  const state = {
    ...base,
    girl: { ...base.girl, y: groundY - base.girl.height, velocityY: 0 },
    obstacles: [{ kind: "pit", x: 70, y: groundY, width: 90, height: base.groundHeight, passed: false }]
  };
  const next = stepRunner(state, fixedRng(0));
  assert.equal(next.isFallingIntoPit, true);
  assert.equal(next.isGameOver, false);
});

test("pit does not cause collision while jumping over it", () => {
  const base = createInitialState({}, fixedRng(0));
  const groundY = base.height - base.groundHeight;
  const state = {
    ...base,
    girl: { ...base.girl, y: groundY - base.girl.height - 80, velocityY: -3 },
    obstacles: [{ kind: "pit", x: 70, y: groundY, width: 90, height: base.groundHeight, passed: false }]
  };
  const next = stepRunner(state, fixedRng(0));
  assert.equal(next.isGameOver, false);
});

test("falling into pit eventually ends game", () => {
  const base = createInitialState({}, fixedRng(0));
  const groundY = base.height - base.groundHeight;
  let state = {
    ...base,
    girl: { ...base.girl, y: groundY - base.girl.height, velocityY: 0 },
    obstacles: [{ kind: "pit", x: 70, y: groundY, width: 90, height: base.groundHeight, passed: false }]
  };

  state = stepRunner(state, fixedRng(0));
  for (let i = 0; i < 120 && !state.isGameOver; i += 1) {
    state = stepRunner(state, fixedRng(0));
  }
  assert.equal(state.isGameOver, true);
});
