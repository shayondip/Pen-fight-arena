# Delivery report

**Project:** Pen Fight Arena
**Latest change:** Play vs AI single-player mode
**Date:** 23 October 2026

---

## 1. The constraint, unchanged

**This sandbox still has no route to the npm registry** (`403 connect_rejected`
for npmjs, PyPI, crates.io and the Yarn mirror). So as before:

- `npm install` was never run.
- Vite and the project builds were never executed.
- No frame of this game has been rendered.

What follows separates **what I actually ran** from **what runs on your
machine**. Nothing in the first list is a guess.

---

## 2. What changed for Play vs AI

### Files added

| File | What it is |
|---|---|
| `shared/src/ai.ts` | The computer opponent. Difficulty profiles, shot-distance maths, and the controller that decides what to do. Zero dependencies. |
| `server/test/ai.test.ts` | 28 tests covering its behaviour. |

### Files changed

| File | Change |
|---|---|
| `shared/src/types.ts` | `AiDifficulty`; `vsAi` on `RoomView`; `isAi` on `RoomPlayerView`; the `solo:start` event. |
| `shared/src/constants.ts` | `SOLO_COIN_MULTIPLIER`. |
| `shared/src/index.ts` | Exports `ai.js`. |
| `server/src/game/world.ts` | `readVelocity` and `readAxis`, so the AI can see movement and pen orientation. |
| `server/src/game/match.ts` | Optional AI controller, driven on the match's existing tick. |
| `server/src/game/rooms.ts` | `createSoloRoom`, the AI seat, solo-aware leave/sweep/rematch, and a separate result path that pays coins without recording anything. |
| `server/src/store/types.ts`, `jsonStore.ts`, `prismaStore.ts` | `awardCoins`. |
| `server/src/net/socket.ts` | `solo:start` handler. |
| `client/src/state/store.ts` | `selectedDifficulty`. |
| `client/src/net/socket.ts` | `startSoloMatch`. |
| `client/src/ui/MainMenu.tsx` | Rebuilt as two labelled modes: Play vs AI first, then Online multiplayer. |
| `client/src/ui/ResultOverlay.tsx` | Solo branch: Play again plus Easy/Medium/Hard switching. |
| `client/src/ui/Hud.tsx` | Shows the practice difficulty. |
| `client/src/App.tsx` | Rejoining a practice match skips the lobby. |
| `client/src/styles.css` | Section dividers and the difficulty switcher. |
| `server/test/match.test.ts`, `multiplayer.test.ts`, `jsonStore.test.ts` | 13 further tests for the AI match, the solo socket flow, and coin awards. |

**Nothing was removed or rewritten in the online path.** `createRoom`,
`joinRoom`, `setReady`, `voteRematch`, the Elo write and the match-record write
all behave exactly as they did; solo play is a branch alongside them, not a
replacement.

---

## 3. Where the AI lives, and why

Your requirement 5 asked for AI mode to work "even if the multiplayer server or
internet is unavailable, **where the existing frontend architecture permits
it**". It does not permit it, and here is the honest reason.

This game is server-authoritative: Rapier runs on the server and the browser
holds no physics at all. That is the property that makes the online mode
trustworthy. Running the AI in the browser would have meant a second copy of
the rules in a second place, free to drift from the first - which is exactly
what your "avoid duplicating the entire game engine" instruction rules out.

**So the AI runs inside the same `Match` the online mode uses**, driving slot B
on the same 60 Hz tick. The consequences are all good ones:

- It reuses the real physics, collision detection, boundary rules and result
  logic. Not a reimplementation - the same code.
- Its shots are the *same charge and fire intents a mouse produces*, fed
  through the *same server-side validation*. It cannot exceed the power it
  actually charged, cannot fire on cooldown, and there is no code path by which
  it could move your pen. The controller is bound to one slot at construction
  and the action type carries no slot field at all.
- There are no AI timers, intervals or animation loops. It rides the match
  loop, so disposing the match disposes the AI. Nothing to leak on restart.

**The practical cost:** Play vs AI needs the local game server process running.
`npm run dev` starts it, so it works with the Wi-Fi switched off - but it will
not work on a frontend-only deployment with no backend. That is the one part of
requirement 5 I did not meet, and I am not going to describe it as met.

---

## 4. What I actually ran, with results

### Tests

The suite is now **163 tests across 10 files**, up from 122. I ran the seven
that need no third-party package, against the real source:

```
  121 passed, 0 failed, 0 skipped
```

| Suite | Tests | Ran here | Covers |
|---|---:|---|---|
| **`ai.test.ts`** | **28** | **Yes - all passed** | **Difficulty ordering, shot maths, charge/fire sequencing, cooldowns, out-of-bounds recovery, slot binding, reset, and four measured behaviour differences** |
| `jsonStore.test.ts` | 18 | **Yes - all passed** | Profiles, secrets, economy, leaderboards, history, restart, and the new coin awards |
| `rules.test.ts` | 20 | **Yes - all passed** | Shrinking area, falling, grace timer, draw window, clock |
| `validate.test.ts` | 21 | **Yes - all passed** | Nicknames, room codes, every anti-cheat rejection, rate limiter |
| `normalize.test.ts` | 13 | **Yes - all passed** | Ranked normalisation, upgrade curves, cost ladder |
| `interp.test.ts` | 11 | **Yes - all passed** | Snapshot interpolation, render delay, reordering, slerp |
| `elo.test.ts` | 10 | **Yes - all passed** | Expected score, K-factor, zero-sum, upsets, floor |
| `match.test.ts` | 19 | No - needs Rapier | Lifecycle, power capping, elimination, **plus 6 new AI-match tests** |
| `physics.test.ts` | 12 | No - needs Rapier | Settling, mass, travel, spin, edge falls, momentum |
| `multiplayer.test.ts` | 11 | No - needs Socket.IO | Two-client match, **plus 4 new solo-flow tests** |

### Typechecks

All three workspaces compile clean under their own strict settings
(`strict` + `noUncheckedIndexedAccess`): **shared 0 errors, server 0 errors,
client 0 errors**. The server and client checks run against hand-written
declarations mirroring the real library APIs, so they verify this project's own
types rather than the calls into Express, React, three or Rapier.

### Measured AI behaviour

Not a claim - output from running the controller for 30 matches per difficulty:

```
easy    27 shots/min  avg power 0.83  self-KO risk 53%  opening aim error 3.17deg
medium  33 shots/min  avg power 0.79  self-KO risk 34%  opening aim error 1.36deg
hard    39 shots/min  avg power 0.77  self-KO risk  0%  opening aim error 0.40deg
```

Difficulty changes real behaviour on four independent axes, each with its own
passing test: how often it acts, how straight it aims, how fast it answers your
shot, and whether it works out that a shot would carry it off the desk.

### Three bugs this caught

1. **`AiController` risk model was inverted in effect.** Hard still overshot
   its own safe charge while Easy's low power cap made it accidentally safe.
   The ceiling formula now interpolates from a margin *under* the safe power,
   and Easy's cap was raised so its recklessness actually shows. Self-KO risk
   went from Easy 25% / Hard 100% to Easy 53% / Hard 0%.
2. **An aim-accuracy test measured angle differences with `atan2`**, which
   wraps at ±π and reported near-perfect shots as terrible ones. Replaced with
   a dot product.
3. **That same test then measured variety instead of accuracy** - the faster
   tiers fire more, so they trip the anti-grooving rule more often. It now
   measures each AI's opening shot, before any history exists.

---

## 5. What still runs only on your machine

- **The 42 remaining tests**, including all 6 new AI-match tests and the 4 solo
  socket tests. `npm test`
- **Both production builds.** `npm run build`
- **The real typecheck against actual library types.** `npm run typecheck`
- **Everything visual**, including the rebuilt menu and the difficulty picker.
- **Whether Hard is actually hard.** The AI's decisions are tested; how those
  decisions feel against real Rapier collisions is not something I could play.

The most likely thing needing adjustment is the AI's `aggression` and
`decisionIntervalMs` in `shared/src/ai.ts`, which is one small, documented file.

---

## 6. Using it

```
npm install
npm run dev
```

Open <http://localhost:5173>, enter a name, pick **Easy**, **Medium** or
**Hard** under *Play vs AI*, and click Start. The countdown begins immediately.

Change difficulty either from the menu or from the three buttons on the result
screen after a match.

Online multiplayer is unchanged: *Online multiplayer* → Create room → share the
code or the invite link.

---

## 7. Still to configure, for worldwide play

Unchanged from the original delivery: PostgreSQL via `DATABASE_URL` plus
`npm run prisma:push`, a deployed backend on a host that keeps a process alive
with WebSockets, `PUBLIC_URL` and `CORS_ORIGINS` set to your real domain, and
real accounts before running this publicly at any scale.
