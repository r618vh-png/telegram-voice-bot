import test from "node:test";
import assert from "node:assert/strict";
import {
  createInitialState,
  restartGame,
  setDirection,
  stepGame
} from "./gameLogic.js";

function fixedRng(value = 0) {
  return () => value;
}

function sequenceRng(values) {
  let idx = 0;
  return () => {
    const value = values[idx];
    idx += 1;
    return value ?? values[values.length - 1] ?? 0;
  };
}

test("moves snake one cell forward each step", () => {
  const state = createInitialState({ width: 10, height: 10, rng: fixedRng(0) });
  const next = stepGame(state, fixedRng(0));

  assert.equal(next.snake[0].x, state.snake[0].x + 1);
  assert.equal(next.snake[0].y, state.snake[0].y);
  assert.equal(next.score, 0);
});

test("grows and increments score when snake eats food", () => {
  const state = {
    width: 6,
    height: 6,
    snake: [{ x: 2, y: 2 }],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 3, y: 2, type: "GROW" },
    score: 0,
    isGameOver: false,
    didGrowOnLastStep: false
  };

  const next = stepGame(state, fixedRng(0));

  assert.equal(next.snake.length, 2);
  assert.equal(next.score, 1);
  assert.equal(next.didGrowOnLastStep, true);
});

test("wraps around horizontal border instead of game over", () => {
  const state = {
    width: 3,
    height: 3,
    snake: [{ x: 2, y: 1 }],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 0, y: 0, type: "GROW" },
    score: 0,
    isGameOver: false,
    didGrowOnLastStep: false
  };

  const next = stepGame(state);

  assert.equal(next.isGameOver, false);
  assert.equal(next.snake[0].x, 0);
  assert.equal(next.snake[0].y, 1);
});

test("sets game over when hitting self", () => {
  const state = {
    width: 5,
    height: 5,
    snake: [
      { x: 2, y: 2 },
      { x: 2, y: 3 },
      { x: 1, y: 3 },
      { x: 1, y: 2 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 }
    ],
    direction: "UP",
    nextDirection: "LEFT",
    food: { x: 0, y: 0, type: "GROW" },
    score: 0,
    isGameOver: false,
    didGrowOnLastStep: false
  };

  const next = stepGame(state);
  assert.equal(next.isGameOver, true);
});

test("prevents reversing direction immediately", () => {
  const state = createInitialState({ width: 8, height: 8, rng: fixedRng(0) });
  const next = setDirection(state, "LEFT");
  assert.equal(next.nextDirection, "RIGHT");
});

test("food never spawns on snake after growth", () => {
  const state = {
    width: 3,
    height: 3,
    snake: [
      { x: 1, y: 1 },
      { x: 0, y: 1 }
    ],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 2, y: 1, type: "GROW" },
    score: 0,
    isGameOver: false,
    didGrowOnLastStep: false
  };

  const next = stepGame(state, fixedRng(0));
  assert.notEqual(next.food.x === 1 && next.food.y === 1, true);
  assert.notEqual(next.food.x === 0 && next.food.y === 1, true);
  assert.notEqual(next.food.x === 2 && next.food.y === 1, true);
});

test("restart resets score and game over state", () => {
  const state = {
    width: 10,
    height: 10,
    snake: [{ x: 5, y: 5 }],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 4, y: 5, type: "GROW" },
    score: 9,
    isGameOver: true,
    didGrowOnLastStep: false
  };

  const reset = restartGame(state, fixedRng(0));
  assert.equal(reset.score, 0);
  assert.equal(reset.isGameOver, false);
  assert.equal(reset.snake.length, 1);
});

test("shrink food reduces snake length and score", () => {
  const state = {
    width: 6,
    height: 6,
    snake: [
      { x: 2, y: 2 },
      { x: 1, y: 2 },
      { x: 0, y: 2 }
    ],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 3, y: 2, type: "SHRINK" },
    score: 5,
    isGameOver: false,
    didGrowOnLastStep: false
  };

  const next = stepGame(state, fixedRng(0));
  assert.equal(next.snake.length, 2);
  assert.equal(next.score, 4);
});

test("score does not go below zero on shrink food", () => {
  const state = {
    width: 5,
    height: 5,
    snake: [{ x: 1, y: 1 }],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 2, y: 1, type: "SHRINK" },
    score: 0,
    isGameOver: false,
    didGrowOnLastStep: false
  };

  const next = stepGame(state, fixedRng(0));
  assert.equal(next.score, 0);
  assert.equal(next.snake.length, 1);
});

test("spawns shrink food every third or fourth food by cycle", () => {
  const state = {
    width: 6,
    height: 6,
    snake: [{ x: 2, y: 2 }],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 3, y: 2, type: "GROW" },
    foodSpawnCounter: 2,
    nextShrinkAt: 3,
    score: 0,
    isGameOver: false,
    didGrowOnLastStep: false
  };

  const next = stepGame(state, sequenceRng([0, 0.8]));
  assert.equal(next.food.type, "SHRINK");
});

test("shrink food disappears after ttl and is replaced by grow food", () => {
  const state = {
    width: 6,
    height: 6,
    snake: [{ x: 2, y: 2 }],
    direction: "RIGHT",
    nextDirection: "RIGHT",
    food: { x: 4, y: 4, type: "SHRINK", ttlTicks: 1 },
    foodSpawnCounter: 1,
    nextShrinkAt: 4,
    score: 0,
    isGameOver: false,
    didGrowOnLastStep: false
  };

  const next = stepGame(state, fixedRng(0));
  assert.equal(next.food.type, "GROW");
});
