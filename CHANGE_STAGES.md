# Change Stages

## Stage 1
- Runner obstacles rolled back to classic rectangular blocks.
- Removed stacked-block rendering and palette shades.
- Restored obstacle spawn randomness:
  - width: `44..70`
  - height: `58..120`
- Files changed:
  - `runner/gameLogic.js`
  - `runner/app.js`

## Stage 2
- Fixed obstacle flicker in Runner by snapping obstacle draw coordinates and sizes to integer pixels.
- File changed:
  - `runner/app.js`

## Stage 3
- Restored Runner character size to the Vercel-style larger values.
- `girlWidth: 117`
- `girlHeight: 186`
- File changed:
  - `runner/gameLogic.js`

## Stage 4
- Rolled Runner back to the earlier local-preview state (the one with `bg.jpg` support and classic obstacle behavior):
  - Background image loading from `runner/assets/bg.jpg` restored.
  - Obstacle image loading fallback restored (`./assets/obstacle.png`, else gray blocks).
  - Removed pixel-snap/flicker workaround and sprite auto-crop drawing.
  - Character defaults restored to earlier values:
    - `girlWidth: 96`
    - `girlHeight: 154`
    - `jumpVelocity: -14.6`
- Files changed:
  - `runner/app.js`
  - `runner/gameLogic.js`

## Stage 5
- Restored the original Runner background behavior from the initial implementation:
  - Removed image background loading (`bg.jpg`) from runtime.
  - Background is again the original vertical gradient.
- File changed:
  - `runner/app.js`

## Stage 6
- Increased Runner character size by ~10% in both dimensions:
  - `girlWidth: 106`
  - `girlHeight: 169`
- Shifted character slightly left:
  - `girl.x: 46` (was `56`)
- File changed:
  - `runner/gameLogic.js`

## Stage 7
- Fixed perceived character size issue by auto-cropping transparent margins from girl/run/jump frames at draw time.
- Character scaling changes from Stage 6 are now visually noticeable.
- File changed:
  - `runner/app.js`

## Stage 8
- Fixed frame-to-frame character width jitter:
  - Added stable bounds per animation set (run/jump) so all frames use one unified crop area.
  - This keeps the sprite scale consistent across frames.
- File changed:
  - `runner/app.js`

## Stage 9
- Restored character size and position to the earlier baseline:
  - `girlWidth: 96`
  - `girlHeight: 154`
  - `girl.x: 56`
- File changed:
  - `runner/gameLogic.js`

## Stage 10
- Fixed wider character look on collision/game-over frame:
  - Character now keeps using the same run/jump animation frame pipeline even when game is over.
  - Prevents fallback to a differently framed static sprite.
- File changed:
  - `runner/app.js`

## Stage 11
- Increased Runner character size by ~20% from baseline while preserving all recent animation/cropping fixes:
  - `girlWidth: 115`
  - `girlHeight: 185`
- File changed:
  - `runner/gameLogic.js`

## Stage 12
- Ensured visible +20% character scale at render time (to avoid frame-padding illusions):
  - Added `GIRL_RENDER_SCALE = 1.2`.
  - Character drawing now uses bottom-center anchored scaled render box.
- File changed:
  - `runner/app.js`

## Stage 13
- Increased jump height by ~10%:
  - `jumpVelocity: -16.1` (was `-14.6`)
- File changed:
  - `runner/gameLogic.js`

## Stage 14
- Added pits as a second hazard type in Runner (alongside blocks):
  - Hazard spawn now mixes `block` and `pit` (pits appear with lower probability).
  - Pits must be jumped over; touching pit zone on ground causes game over.
  - Pits are rendered as dark holes in the ground with a highlighted edge.
- Added tests for pit collision behavior:
  - Grounded over pit => game over.
  - Airborne over pit => no collision.
- Files changed:
  - `runner/gameLogic.js`
  - `runner/app.js`
  - `runner/gameLogic.test.js`

## Stage 15
- Updated pit behavior and visuals:
  - Pits are now white.
  - On pit contact (while grounded), the runner enters a falling state instead of instant game over.
  - Game over triggers after the character falls out of the screen.
- Updated tests for new pit behavior:
  - Grounded pit contact => falling state.
  - Jumping over pit => safe.
  - Falling eventually => game over.
- Files changed:
  - `runner/gameLogic.js`
  - `runner/app.js`
  - `runner/gameLogic.test.js`

## Stage 16
- Removed the remaining gray top edge on pits.
- Pits are now fully white with no border/line.
- File changed:
  - `runner/app.js`

## Stage 17
- Added collectible coins and switched scoring to coins only.
- Coins spawn in three vertical lanes:
  - bottom (ground level),
  - middle,
  - top (jump-required lane).
- Score now increases only when a coin is collected.
- Added coin rendering (gold circles) in Runner.
- Added tests:
  - coin collection increases score and removes coin,
  - passing obstacles without coins does not increase score.
- Files changed:
  - `runner/gameLogic.js`
  - `runner/app.js`
  - `runner/gameLogic.test.js`

## Stage 18
- Adjusted coin lanes:
  - Removed bottom lane coins.
  - Kept only middle and top lanes.
  - Raised top-lane coins by ~20% higher than before.
- File changed:
  - `runner/gameLogic.js`

## Stage 19
- Increased coin size 2x:
  - `coin size: 44` (was `22`)
- Reduced character model size by ~20%:
  - `girlWidth: 92`
  - `girlHeight: 148`
- Set render scale back to neutral:
  - `GIRL_RENDER_SCALE = 1`
- Files changed:
  - `runner/gameLogic.js`
  - `runner/app.js`

## Stage 20
- Coin/hazard separation rules:
  - Coins now avoid obstacle zones (with extra horizontal margin).
  - Coin spawn is skipped if a safe placement is not found.
  - Coins that drift into an obstacle zone are removed.
- This enforces: either jump for coin or jump for obstacle, not both at the same spot.
- Added test coverage for blocked coin spawn near obstacles.
- Files changed:
  - `runner/gameLogic.js`
  - `runner/gameLogic.test.js`

## Stage 21
- Replaced coin drawing with image asset:
  - Uses `runner/assets/logo.png` by default.
  - Optional override via query param: `?coin=...`
  - Keeps circle fallback only if image fails to load.
- File changed:
  - `runner/app.js`

## Stage 22
- Added game-over stats line in Runner with Telegram user name and score:
  - Shows `Игрок: @username` (or first/last name fallback).
  - Keeps score visible in the same end-of-run overlay.
- File changed:
  - `runner/app.js`

## Stage 23
- Added a clear post-game stats panel below canvas:
  - Shows player name (`Игрок: ...`) and final score.
  - Visible only after game over, hidden during gameplay.
- Files changed:
  - `runner/index.html`
  - `runner/styles.css`
  - `runner/app.js`

## Stage 24
- Strengthened end-of-run stats visibility directly on canvas:
  - Added centered "Статистика" card on game-over overlay.
  - Explicit lines: `Игрок: ...` and `Очки: ...`.
  - Added restart hint on the same card.
- File changed:
  - `runner/app.js`

## Stage 25
- Fixed player name in end-of-run stats for Telegram launch flows:
  - Bot now appends `player` query param to Runner WebApp URL from `msg.from`.
  - Runner reads `player` from URL first, then falls back to `Telegram.WebApp.initDataUnsafe.user`.
- Files changed:
  - `index.js`
  - `runner/app.js`

## Stage 26
- Added Runner Top-10 leaderboard (separate from Snake):
  - New command: `/toprunner`
  - Storage file: `data/runner-leaderboard.json`
  - Best-score-per-user logic with Telegram ID binding.
- Runner now auto-sends score to bot on game over via WebApp payload:
  - payload type: `runner_score`
  - one submission per run (resets on restart).
- Bot now handles both score payload types:
  - `snake_score`
  - `runner_score`
- Files changed:
  - `index.js`
  - `runner/app.js`

## Stage 27
- Added Top-10 display directly on Runner game-over screen (inside the app, not chat):
  - Bot now appends Runner top list to Mini App URL (`top=...`).
  - Runner result panel now renders "Топ-10 игроков" list after defeat.
  - Current player's latest score is merged into the shown top list locally for immediate feedback.
- Files changed:
  - `index.js`
  - `runner/index.html`
  - `runner/styles.css`
  - `runner/app.js`

## Stage 28
- Moved Top-10 to appear immediately inside the game-over statistics card on canvas:
  - Order: `Статистика` -> `Игрок`/`Очки` -> `Топ-10 игроков`.
  - Hidden the separate below-canvas result panel to avoid duplicate/low-position display.
- File changed:
  - `runner/app.js`

## Stage 29
- Fixed missing other-player results in the on-canvas Top-10:
  - Bot now appends a cache-busting `ts` param to Runner URL to ensure fresh top list.
  - Runner now renders the exact top list from URL and appends a "Ты: ..." line without replacing others.
- Files changed:
  - `index.js`
  - `runner/app.js`

## Stage 30
- "Ты" line now shows best attempt, not last:
  - If the player is already in Top-10, display max of Top-10 score and current run score.
  - Otherwise show current run score.
- File changed:
  - `runner/app.js`

## Stage 31
- Top-10 now always reflects the best attempt per player (not the last run):
  - Merges current run into Top-10 using max(previous, current) before rendering.
  - Keeps Top-10 ordering and limits to 10 entries.
- File changed:
  - `runner/app.js`

## Stage 32
- Top-10 now matches players by Telegram user id (not name) to preserve best scores:
  - Bot includes `userId` in Runner top list and `playerId` in URL.
  - Runner merges and displays Top-10 using `userId` when available.
  - Best score line uses max(best-in-top, current).
- File changed:
  - `index.js`
  - `runner/app.js`

## Stage 33
- Ensured best attempt is shown even across multiple runs without reopening the app:
  - Store player's best score in `localStorage` (by `playerId` or name).
  - Use max(top, stored, current) for "Лучший" and top list merge.
- File changed:
  - `runner/app.js`

## Stage 34
- Improved Top-10 visibility in the stats card:
  - Increased card height to fit up to 10 rows.
  - Reduced font size and tightened spacing.
  - Shows "Топ пока пуст" if no entries.
- File changed:
  - `runner/app.js`

## Stage 35
- Added commands for Runner leaderboards in chat:
  - `/toprunner` shows top 10.
  - `/toprunner100` shows top 100.
- `/start` help text updated to include new command.
- File changed:
  - `index.js`
