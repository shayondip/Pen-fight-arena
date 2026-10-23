# Pen Fight Arena

A real-time 3D pen fight. Two pens sit either side of a wooden school desk,
aim, charge a flick and let go. Whoever's pen leaves the marked playing area
first loses. Both out together is a draw.

Play it two ways:

- **Play vs AI** - one player against the computer, on Easy, Medium or Hard.
  Starts instantly, no room code, nobody else needed.
- **Online multiplayer** - two people, two machines, one room code.

The physics is simulated on the server with Rapier, not in the browser. The
clients send aim and charge intents; the server decides where the pens actually
go and streams snapshots back. That means two people on two different machines
see the same match, and a modified client cannot make its pen fly further.

---

## 1. What you need

| Requirement | Version | Notes |
|---|---|---|
| **Node.js** | **20.11 or newer** (22 LTS recommended) | <https://nodejs.org> — the installer adds `node` and `npm` to your PATH. |
| npm | 10 or newer | Ships with Node.js. |
| A modern browser | Chrome, Edge or Firefox | Needs WebGL 2. Any GPU from the last decade is fine. |
| PostgreSQL | 14 or newer | **Optional.** Only needed for shared worldwide accounts and rankings. |

Check your version:

```
node -v
```

If it prints anything below `v20.11.0`, install the current LTS first.

### VS Code extensions

None are required — the project builds and runs from the terminal. These make
working on it nicer:

- **Prisma** (`prisma.prisma`) — syntax highlighting for `server/prisma/schema.prisma`
- **ESLint** (`dbaeumer.vscode-eslint`)
- **Prettier** (`esbenp.prettier-vscode`)
- **Vitest** (`vitest.explorer`) — run tests from the sidebar

VS Code offers these automatically when you open the folder; the list lives in
`.vscode/extensions.json`.

---

## 2. Getting it running

1. **Extract the ZIP.** Right-click `pen-fight-arena.zip` → *Extract All…* →
   pick a folder, for example `C:\Projects`. Avoid extracting inside
   OneDrive or Desktop sync folders: file-locking there slows `npm install`
   down and sometimes breaks it.
2. **Open the folder in VS Code.** *File → Open Folder…* → select the
   `pen-fight-arena` folder (the one with `package.json` directly inside it).
3. **Open a terminal in VS Code.** *Terminal → New Terminal*, or `` Ctrl+` ``.
4. **Install and run:**

```
npm install
npm run dev
```

5. **Open the address the terminal prints** — normally
   <http://localhost:5173>.

That is the whole process. `npm install` builds the shared package
automatically, and `npm run dev` starts the game server and the web client
together in one terminal.

### Or just double-click

If you would rather not touch the terminal:

- **`setup.bat`** — checks your Node.js version, installs dependencies, creates
  `.env`, generates the Prisma client if it can, and reports anything missing.
- **`start.bat`** — starts the game. The window stays open when it stops, so
  you can read any error.

Run `setup.bat` once, then `start.bat` whenever you want to play.

### Every root command

| Command | What it does |
|---|---|
| `npm install` | Installs all three workspaces and builds `shared`. |
| `npm run dev` | Game server on **:4000** and client on **:5173**, together. |
| `npm run build` | Type-checks and builds shared, server and client for production. |
| `npm test` | Runs the full Vitest suite (logic, AI behaviour, physics, and a real two-client match). |
| `npm run typecheck` | TypeScript check across every workspace, no build output. |
| `npm run start` | Runs the built server. Use after `npm run build`. |
| `npm run doctor` | Checks Node version, dependencies and configuration, and prints fixes. |
| `npm run prisma:generate` | Generates the Prisma client. Needs no database. |
| `npm run prisma:push` | Creates the tables in the database `DATABASE_URL` points at. |

---

## 3. Play vs AI

Open the menu, pick a difficulty under **Play vs AI**, and click **Start**. The
countdown begins at once - no room, no code, no waiting.

| | Easy | Medium | Hard |
|---|---|---|---|
| Opening aim error | ~3.2 deg | ~1.4 deg | ~0.4 deg |
| Shots per minute | ~27 | ~33 | ~39 |
| Shots that would carry it off the desk | ~53% | ~34% | 0% |
| Leads a moving target | no | no | yes |
| Aims through you towards your nearest edge | no | yes | yes |
| Holds fire when you are already sliding out | no | yes | yes |

Those are measured numbers, not labels - the figures come from the behaviour
test in `server/test/ai.test.ts`.

The big difference between the tiers is nerve. Easy swings with power that
overruns the desk and regularly flicks itself into the grass; Hard works out
how much room is behind you and caps its charge so it never does. Medium sits
between the two.

**The computer always plays a stock pen.** Difficulty is skill, never stats, so
the upgrades you buy in the Workshop genuinely count against it.

Practice matches pay **half coins** and leave your rating, your win/loss record
and the leaderboard completely untouched. A bot is not a stored player, and it
is never going to appear on a worldwide board.

**Play again** restarts instantly, and the result screen has Easy / Medium /
Hard buttons so you can switch opponent without going back to the menu.

---

## 4. Playing two players

### Both players on one computer (the quickest test)

1. Run `npm run dev`.
2. Open <http://localhost:5173>, type a name, pick an arena, click
   **Create room**. A five-character room code appears.
3. Open a **second window** for player two. Either of these works:
   - a private / incognito window at <http://localhost:5173>, or
   - a normal tab at **<http://localhost:5173/?guest=1>**
4. In the second window, type the room code and click **Join room**.
5. Both click **I'm ready**. A three-second countdown starts, then play.

> **Why the second window has to be special.** A profile belongs to a browser
> profile, so two ordinary tabs in the same window are the *same* player, and
> the server refuses to seat one person twice. `?guest=1` gives that tab its own
> identity in `sessionStorage`, which makes it a genuinely separate player.

### Two computers on the same Wi-Fi

1. On the host machine, find its local IP: run `ipconfig` and read the
   **IPv4 Address**, e.g. `192.168.1.24`.
2. In `.env`, set:

   ```
   PUBLIC_URL=http://192.168.1.24:5173
   ```

3. Restart with `npm run dev`.
4. The second computer opens `http://192.168.1.24:5173`.

If it will not connect, allow Node.js through Windows Defender Firewall on
**private** networks. Windows usually prompts the first time you run the server.

### Two people on different internet connections

This needs the backend deployed somewhere public — see
[Deployment](#7-deployment). Over the open internet, `localhost` only ever means
"this computer", and a home router will not accept incoming connections without
port forwarding. The invite link is designed for this: once the server is
deployed, the link in the lobby is all your opponent needs.

### Controls

| | Aim | Charge | Fire |
|---|---|---|---|
| **Mouse** | Drag backwards from anywhere on the board | Hold — drag further for more power | Release |
| **Touch** | Same drag, with your finger | Same | Lift your finger |
| **Keyboard** | `←` `→` or `A` `D` | Hold `Space` | Release `Space` |

It is a slingshot: pull back, let go, the pen goes the other way. `Esc` cancels
a charge.

The gamble at the centre of the game: a full-power shot travels slightly further
than the width of the desk. Connect and you will usually knock them off; miss
and you will usually be the one who sails over the line. You get 1.5 seconds
outside the line to fire again and push yourself back in.

After the first minute the marked area starts closing in, so a stalemate cannot
run out the clock.

---

## 5. Storage: local by default, PostgreSQL when you want it

The game works fully without a database, and it tells you which one it is using
rather than leaving you to guess.

| | Local development storage | PostgreSQL |
|---|---|---|
| Set up | Nothing to do | `DATABASE_URL` + `npm run prisma:push` |
| Where data lives | `server/.data/dev-store.json` | Your database |
| Survives restarts | Yes | Yes |
| Accounts, coins, upgrades | Yes | Yes |
| Match history | Yes | Yes |
| Leaderboards | Yes, **but only of people who played on this machine** | Yes, shared across every player |

The server prints which backend it chose at startup, `GET /api/health` reports
it, and the menu, lobby and leaderboard screens all say so in plain language.
A local leaderboard is never presented as a worldwide one.

### Enabling PostgreSQL

1. **Install PostgreSQL** from <https://www.postgresql.org/download/windows/>,
   or run one in Docker:

   ```
   docker run --name penfight-db -e POSTGRES_PASSWORD=penfight -p 5432:5432 -d postgres:16
   ```

2. **Create a database.** Using `psql`:

   ```
   psql -U postgres -c "CREATE DATABASE penfight;"
   ```

3. **Point `.env` at it.** Uncomment `DATABASE_URL` and fill in your password:

   ```
   DATABASE_URL=postgresql://postgres:penfight@localhost:5432/penfight?schema=public
   ```

4. **Create the tables:**

   ```
   npm run prisma:generate
   npm run prisma:push
   ```

5. **Restart** with `npm run dev`. The startup log should now read
   `Storage: postgres`.

If the database is unreachable or the tables are missing, the server says so and
falls back to local storage rather than refusing to start — your game keeps
working while you sort the database out.

---

## 6. How it is put together

```
pen-fight-arena/
  shared/        Types, constants and all the rules both sides must agree on:
                 Elo, elimination, ranked normalisation, input validation,
                 snapshot interpolation, arena and skin definitions.
  shared/src/ai.ts   The computer opponent. Pure decision logic with no
                     dependencies, which is why its behaviour is unit tested.
  server/        Express + Socket.IO + Rapier. Owns the simulation.
    src/game/    world.ts (physics bodies), match.ts (one authoritative match,
                 optionally driving an AI opponent on the same tick),
                 rooms.ts (seating, solo rooms, reconnects, results),
                 loop.ts (fixed tick)
    src/store/   Storage interface with PostgreSQL and local-JSON adapters
    src/net/     Socket protocol
    src/http/    REST API
    test/        Vitest suites
  client/        Vite + React + Three.js + React Three Fiber + drei
    src/game/    The 3D scene, all of it generated in code
    src/ui/      Menu, lobby, HUD, workshop, leaderboard, profile, settings
  scripts/       doctor.mjs
```

**The network model.** The server steps Rapier at a fixed 60 Hz and broadcasts
a snapshot 20 times a second. Clients buffer those snapshots and render 110 ms
in the past, interpolating between the two that straddle the render clock. That
turns a 20 Hz feed into steady motion without the client ever guessing at
physics. Clock offset is measured with a ping every three seconds.

**What the server refuses.** Power is clamped to 0–1 and additionally capped at
the charge the player actually held, so a client claiming a full-power shot
after a 50 ms tap gets a 50 ms shot. Aim vectors are re-normalised. Cooldowns
and minimum charge times are enforced server-side. Each socket carries a token
bucket. Only the two seated players can send inputs. Every profile has a secret
issued at first sign-in and stored only as a hash; spending coins requires it.

**How the AI fits in.** The computer opponent is not a second game engine. It
sits in the same `Match` the online mode uses, on the same 60 Hz tick, and
returns the *same charge and fire intents a mouse produces*. Those go through
the identical server-side validation a human's shot does, so the AI cannot
exceed the power it charged, cannot fire on cooldown, and has no code path by
which it could move your pen. Disposing the match disposes the AI - there are
no separate timers or animation loops to leak.

**No external assets.** Every pen, desk, tree, sky, texture and sound effect is
generated at runtime from code — procedural canvas textures, primitive geometry,
Web Audio oscillators. There is no CDN, no HDRI, no sprite sheet and no audio
file, so nothing in this project can fail to load.

---

## 7. Deployment

The client is static files; the server is a long-lived Node process that needs
WebSockets. They can go to one host or two.

### Server

Any host that runs Node and allows WebSockets — Railway, Render, Fly.io, a VPS.

```
npm install
npm run build
npm run start
```

Environment variables to set:

```
PORT=4000
DATABASE_URL=postgresql://...        # for real worldwide rankings
PUBLIC_URL=https://your-site.example # so invite links point at the right place
CORS_ORIGINS=https://your-site.example
```

Serverless and edge platforms will **not** work for the server: it holds
in-memory physics worlds and open WebSocket connections, so it needs a process
that stays alive.

### Client

Build it and upload `client/dist` to any static host (Netlify, Vercel, Cloudflare
Pages, GitHub Pages):

```
npm run build
```

If the client is on a different domain from the server, set `VITE_SERVER_URL`
to the server's URL **before** building, and add the client's origin to
`CORS_ORIGINS` on the server.

### One service instead of two

Simpler for a small deployment:

```
SERVE_CLIENT=true
```

The server then serves the built client from `client/dist` alongside the API, so
there is one URL and no CORS configuration at all.

---

## 8. Known limitations

- **Two players per room.** No spectators and no tournament bracket.
- **Play vs AI needs the local game server running**, because all physics lives
  on the server - which is what makes the online mode trustworthy. `npm run dev`
  starts it, so you can play with the Wi-Fi off, but a frontend-only deployment
  with no backend will not have AI mode. Making it run purely in the browser
  would mean a second copy of the rules that could drift from the first.
- **Practice matches are not recorded.** No rating change, no win/loss, no
  match history, nothing on the leaderboard. Coins only, at half rate.
- **Identity is a browser token, not a password.** Clearing site data loses the
  profile, and the same person on two devices is two profiles. The secret stops
  impersonation; it is not a login system. Add OAuth before running this
  publicly at any scale.
- **Rooms live in one process.** Running several server instances behind a load
  balancer needs sticky sessions, or a shared room registry in Redis.
- **The reconnect window is 45 seconds.** Longer than that and the match is
  forfeited.
- **Weekly and monthly leaderboards aggregate in Node**, not in SQL. That is
  correct and fast at hobby scale; at tens of thousands of matches per month it
  should become a database query.
- **A full-power shot can carry your own pen off the desk.** This is deliberate,
  not a bug.
- **Mobile browsers throttle background tabs.** A backgrounded tab stops
  rendering; the server pauses the match when a player drops and resumes when
  they return.
- **No audio until you interact with the page.** Browsers require a click or tap
  before sound can start.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `'npm' is not recognized` | Node.js is not installed or not on PATH. Install it, then open a **new** terminal. |
| `npm install` fails or hangs | Check your connection; corporate proxies and antivirus often interfere. Delete `node_modules` and retry. |
| Menu says "Not connected to the game server" | The server half did not start. Look at the `SERVER` lines in the terminal. |
| `EADDRINUSE :4000` | Something else holds the port. Change `PORT` in `.env`, or `netstat -ano \| findstr :4000` then `taskkill /PID <pid> /F`. |
| Black screen, no 3D | WebGL 2 is unavailable or blocked. Check `chrome://gpu`, update the graphics driver, and turn hardware acceleration on. |
| Second tab says the profile is already seated | Use a private window, or add `?guest=1`. See [Playing two players](#4-playing-two-players). |
| Low frame rate | Settings → Graphics → **Low**. |
| Play vs AI button does nothing | The server half is not running. Check the `SERVER` lines in the terminal, then `npm run doctor`. |
| Leaderboard is empty | That is correct on a new server — it only ever shows real stored matches. Play one. |

Run `npm run doctor` for a check of the whole setup with a fix printed for
anything it finds.

---

## License

MIT.
