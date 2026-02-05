import test from "node:test";
import assert from "node:assert/strict";
import {
  createEmptyLeaderboard,
  getTopEntries,
  normalizeScore,
  upsertBestScore
} from "./leaderboard.js";

test("normalizeScore validates bounds and integers", () => {
  assert.equal(normalizeScore(12.9), 12);
  assert.equal(normalizeScore(-1), null);
  assert.equal(normalizeScore("abc"), null);
});

test("upsertBestScore keeps best result per telegram user id", () => {
  const empty = createEmptyLeaderboard();
  const user = { id: 42, username: "didar" };

  const first = upsertBestScore(empty, user, 5, "2026-02-04T12:00:00.000Z");
  assert.equal(first.bestScore, 5);
  assert.equal(first.rank, 1);
  assert.equal(first.isNewRecord, true);

  const lower = upsertBestScore(first.leaderboard, user, 3, "2026-02-04T12:05:00.000Z");
  assert.equal(lower.bestScore, 5);
  assert.equal(lower.isNewRecord, false);

  const higher = upsertBestScore(lower.leaderboard, user, 9, "2026-02-04T12:10:00.000Z");
  assert.equal(higher.bestScore, 9);
  assert.equal(higher.isNewRecord, true);
});

test("getTopEntries sorts by score desc", () => {
  const board = {
    version: 1,
    updatedAt: "2026-02-04T12:00:00.000Z",
    entries: [
      { userId: 1, bestScore: 4, displayName: "@u1" },
      { userId: 2, bestScore: 10, displayName: "@u2" },
      { userId: 3, bestScore: 7, displayName: "@u3" }
    ]
  };

  const top = getTopEntries(board, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].userId, 2);
  assert.equal(top[1].userId, 3);
});

