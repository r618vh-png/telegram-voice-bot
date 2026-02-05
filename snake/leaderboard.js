export const MAX_SCORE = 1_000_000;

export function createEmptyLeaderboard() {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    entries: []
  };
}

export function normalizeScore(rawScore) {
  const score = Number(rawScore);
  if (!Number.isFinite(score)) return null;
  const normalized = Math.floor(score);
  if (normalized < 0 || normalized > MAX_SCORE) return null;
  return normalized;
}

export function getDisplayName(user = {}) {
  if (user.username) return `@${user.username}`;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || `id:${user.id}`;
}

export function upsertBestScore(leaderboard, user, score, isoNow = new Date().toISOString()) {
  const entries = Array.isArray(leaderboard?.entries) ? [...leaderboard.entries] : [];
  const userId = Number(user?.id);
  const idx = entries.findIndex((item) => item.userId === userId);

  const nextEntry = {
    userId,
    username: user?.username || "",
    firstName: user?.first_name || "",
    lastName: user?.last_name || "",
    displayName: getDisplayName(user),
    bestScore: score,
    updatedAt: isoNow
  };

  let previousBest = null;
  let isNewRecord = true;

  if (idx >= 0) {
    previousBest = entries[idx].bestScore;
    if (previousBest >= score) {
      isNewRecord = false;
      nextEntry.bestScore = previousBest;
    }
    entries[idx] = { ...entries[idx], ...nextEntry };
  } else {
    entries.push(nextEntry);
  }

  const sorted = [...entries].sort((a, b) => b.bestScore - a.bestScore || a.userId - b.userId);
  const rank = sorted.findIndex((item) => item.userId === userId) + 1;

  return {
    leaderboard: {
      version: 1,
      updatedAt: isoNow,
      entries
    },
    rank,
    previousBest,
    bestScore: sorted[rank - 1]?.bestScore ?? score,
    isNewRecord
  };
}

export function getTopEntries(leaderboard, limit = 10) {
  const entries = Array.isArray(leaderboard?.entries) ? leaderboard.entries : [];
  return [...entries]
    .sort((a, b) => b.bestScore - a.bestScore || a.userId - b.userId)
    .slice(0, limit);
}

