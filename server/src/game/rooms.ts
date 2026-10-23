import {
  AiController,
  COINS_DRAW,
  COINS_HIT_CAP,
  COINS_LOSS,
  COINS_PER_HIT,
  COINS_WIN,
  DEFAULT_ARENA_ID,
  DEFAULT_ATTRIBUTES,
  RANKED_COIN_MULTIPLIER,
  RECONNECT_GRACE_MS,
  SOLO_COIN_MULTIPLIER,
  attributesForMode,
  getAiProfile,
  buildInviteUrl,
  generateUniqueRoomCode,
  outcomeToScoreA,
  updateElo,
} from '@pfa/shared';
import type {
  AiDifficulty,
  ErrorPayload,
  GameMode,
  MatchEvent,
  MatchOutcome,
  MatchResultView,
  PenAttributes,
  PlayerProfile,
  PlayerSlot,
  PublicProfile,
  RoomView,
  Snapshot,
} from '@pfa/shared';

import { logger } from '../logger.js';
import type { Store } from '../store/types.js';
import { GameLoop } from './loop.js';
import { Match } from './match.js';
import type { MatchFinish } from './match.js';

export interface RoomBroadcaster {
  roomState(code: string, view: RoomView): void;
  countdown(code: string, secondsLeft: number): void;
  matchStart(code: string, startedAt: number): void;
  snapshot(code: string, snapshot: Snapshot): void;
  matchEvent(code: string, event: MatchEvent): void;
  matchOver(code: string, result: MatchResultView): void;
  profileUpdate(socketId: string, profile: PlayerProfile): void;
  error(socketId: string, payload: ErrorPayload): void;
  /** Adds/removes a socket from the room's broadcast group. */
  attach(socketId: string, code: string): void;
  detach(socketId: string, code: string): void;
}

interface Seat {
  slot: PlayerSlot;
  profileId: string;
  clientId: string;
  nickname: string;
  socketId: string | null;
  connected: boolean;
  ready: boolean;
  rematchVote: boolean;
  rawAttributes: PenAttributes;
  effectiveAttributes: PenAttributes;
  skinId: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  draws: number;
  disconnectTimer: NodeJS.Timeout | null;
  /** True for the computer opponent. AI seats hold no socket and never drop. */
  isAi: boolean;
}

interface Room {
  code: string;
  mode: GameMode;
  arenaId: string;
  hostSlot: PlayerSlot;
  seats: Partial<Record<PlayerSlot, Seat>>;
  match: Match | null;
  lastResult: MatchResultView | null;
  createdAt: number;
  closing: boolean;
  /** Difficulty when this is a Play vs AI room, otherwise null. */
  vsAi: AiDifficulty | null;
  aiController: AiController | null;
}

export type RoomOutcome =
  | { ok: true; room: RoomView; slot: PlayerSlot }
  | { ok: false; error: ErrorPayload };

function fail(code: string, message: string): { ok: false; error: ErrorPayload } {
  return { ok: false, error: { code, message } };
}

function toPublic(seat: Seat): PublicProfile {
  return {
    id: seat.profileId,
    nickname: seat.nickname,
    rating: seat.rating,
    wins: seat.wins,
    losses: seat.losses,
    draws: seat.draws,
    gamesPlayed: seat.gamesPlayed,
    skinId: seat.skinId,
  };
}

/** Coins awarded for one match. */
export function computeCoins(
  outcome: MatchOutcome,
  slot: PlayerSlot,
  mode: GameMode,
  hits: number,
): number {
  const base = outcome === 'draw' ? COINS_DRAW : outcome === slot ? COINS_WIN : COINS_LOSS;
  const hitBonus = Math.min(COINS_HIT_CAP, Math.max(0, hits) * COINS_PER_HIT);
  const total = (base + hitBonus) * (mode === 'ranked' ? RANKED_COIN_MULTIPLIER : 1);
  return Math.round(total);
}

/**
 * Owns every room on the server: seating, readiness, the live match, the
 * reconnection window, rematches, and the persistence that follows a result.
 */
export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly socketToRoom = new Map<string, string>();
  private readonly loop = new GameLoop();
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: Store,
    private readonly broadcaster: RoomBroadcaster,
    private readonly publicUrl: string,
  ) {
    this.sweeper = setInterval(() => this.sweep(), 30_000);
    this.sweeper.unref?.();
  }

  shutdown(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const room of this.rooms.values()) this.closeRoom(room);
    this.loop.stop();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get liveMatchCount(): number {
    return this.loop.size;
  }

  // -------------------------------------------------------------------------
  // Room lifecycle
  // -------------------------------------------------------------------------

  createRoom(
    socketId: string,
    profile: PlayerProfile,
    mode: GameMode,
    arenaId: string,
  ): RoomOutcome {
    this.leave(socketId, { silent: true });

    const code = generateUniqueRoomCode((candidate) => this.rooms.has(candidate));
    const room: Room = {
      code,
      mode,
      arenaId: arenaId || DEFAULT_ARENA_ID,
      hostSlot: 'A',
      seats: {},
      match: null,
      lastResult: null,
      createdAt: Date.now(),
      closing: false,
      vsAi: null,
      aiController: null,
    };

    room.seats.A = this.makeSeat('A', socketId, profile, mode);
    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    this.broadcaster.attach(socketId, code);

    logger.info(`Room ${code} created by ${profile.nickname} (${mode}).`);
    this.pushState(room);
    return { ok: true, room: this.view(room), slot: 'A' };
  }

  /**
   * Opens a single-player match against the computer.
   *
   * There is no code to share, no lobby and no second client: the AI takes
   * seat B and the countdown starts immediately. Everything after this point -
   * the Rapier world, the boundary rules, snapshots, the result screen - is
   * the same code the online mode uses.
   */
  async createSoloRoom(
    socketId: string,
    profile: PlayerProfile,
    difficulty: AiDifficulty,
    arenaId: string,
  ): Promise<RoomOutcome> {
    this.leave(socketId, { silent: true });

    const code = generateUniqueRoomCode((candidate) => this.rooms.has(candidate));
    const room: Room = {
      code,
      // Practice never touches rating, so it runs on casual rules: the player
      // keeps every upgrade they have bought.
      mode: 'casual',
      arenaId: arenaId || DEFAULT_ARENA_ID,
      hostSlot: 'A',
      seats: {},
      match: null,
      lastResult: null,
      createdAt: Date.now(),
      closing: false,
      vsAi: difficulty,
      aiController: new AiController('B', difficulty, Date.now() & 0x7fffffff),
    };

    room.seats.A = this.makeSeat('A', socketId, profile, room.mode);
    room.seats.B = this.makeAiSeat(difficulty);

    this.rooms.set(code, room);
    this.socketToRoom.set(socketId, code);
    this.broadcaster.attach(socketId, code);

    logger.info(`Solo match ${code}: ${profile.nickname} vs ${difficulty} AI.`);
    await this.startMatch(room);

    return { ok: true, room: this.view(room), slot: 'A' };
  }

  joinRoom(socketId: string, profile: PlayerProfile, code: string): RoomOutcome {
    const room = this.rooms.get(code);
    if (!room || room.closing) {
      return fail('room_not_found', `No room with code ${code}.`);
    }

    const existing = this.findSeatByClientId(room, profile.clientId);
    if (existing) {
      return this.reattach(room, existing, socketId, profile);
    }

    const occupiedByOther = (['A', 'B'] as PlayerSlot[]).some(
      (slot) => room.seats[slot]?.profileId === profile.id,
    );
    if (occupiedByOther) {
      return fail(
        'same_profile',
        'That profile already holds a seat in this room. Open the second player in a different browser or add ?guest=1 to the URL.',
      );
    }

    const freeSlot = (['A', 'B'] as PlayerSlot[]).find((slot) => !room.seats[slot]);
    if (!freeSlot) {
      return fail('room_full', 'This room already has two players.');
    }

    this.leave(socketId, { silent: true });

    room.seats[freeSlot] = this.makeSeat(freeSlot, socketId, profile, room.mode);
    this.socketToRoom.set(socketId, room.code);
    this.broadcaster.attach(socketId, room.code);

    logger.info(`${profile.nickname} joined room ${room.code} as ${freeSlot}.`);
    this.pushState(room);
    return { ok: true, room: this.view(room), slot: freeSlot };
  }

  /** Re-seats a returning player (same clientId) after a reload or dropout. */
  private reattach(
    room: Room,
    seat: Seat,
    socketId: string,
    profile: PlayerProfile,
  ): RoomOutcome {
    if (seat.socketId && seat.socketId !== socketId) {
      this.socketToRoom.delete(seat.socketId);
      this.broadcaster.detach(seat.socketId, room.code);
    }

    if (seat.disconnectTimer) {
      clearTimeout(seat.disconnectTimer);
      seat.disconnectTimer = null;
    }

    seat.socketId = socketId;
    seat.connected = true;
    seat.nickname = profile.nickname;
    seat.skinId = profile.skinId;
    seat.rating = profile.rating;

    this.socketToRoom.set(socketId, room.code);
    this.broadcaster.attach(socketId, room.code);

    if (room.match && room.match.getPhase() === 'paused' && this.allConnected(room)) {
      room.match.resume(Date.now());
      logger.info(`Room ${room.code}: match resumed after reconnect.`);
    }

    logger.info(`${profile.nickname} reconnected to room ${room.code} (${seat.slot}).`);
    this.pushState(room);
    return { ok: true, room: this.view(room), slot: seat.slot };
  }

  /** Finds the room a returning client already belongs to, if any. */
  findRoomForClient(clientId: string): string | null {
    for (const room of this.rooms.values()) {
      if (this.findSeatByClientId(room, clientId)) return room.code;
    }
    return null;
  }

  private makeSeat(
    slot: PlayerSlot,
    socketId: string,
    profile: PlayerProfile,
    mode: GameMode,
  ): Seat {
    return {
      slot,
      profileId: profile.id,
      clientId: profile.clientId,
      nickname: profile.nickname,
      socketId,
      connected: true,
      ready: false,
      rematchVote: false,
      rawAttributes: { ...profile.attributes },
      effectiveAttributes: attributesForMode(profile.attributes, mode),
      skinId: profile.skinId,
      rating: profile.rating,
      gamesPlayed: profile.gamesPlayed,
      wins: profile.wins,
      losses: profile.losses,
      draws: profile.draws,
      disconnectTimer: null,
      isAi: false,
    };
  }

  /**
   * Builds the computer opponent's seat.
   *
   * The AI always plays a stock pen with no upgrades. Difficulty comes purely
   * from how well it plays, never from giving it better stats - which also
   * means the upgrades you bought in the Workshop genuinely count against it.
   */
  private makeAiSeat(difficulty: AiDifficulty): Seat {
    const profile = getAiProfile(difficulty);
    return {
      slot: 'B',
      profileId: `ai:${difficulty}`,
      clientId: `ai:${difficulty}`,
      nickname: `${profile.label} AI`,
      socketId: null,
      connected: true,
      ready: true,
      rematchVote: false,
      rawAttributes: { ...DEFAULT_ATTRIBUTES },
      effectiveAttributes: { ...DEFAULT_ATTRIBUTES },
      skinId: difficulty === 'hard' ? 'graphite' : 'crimson-red',
      rating: 0,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      disconnectTimer: null,
      isAi: true,
    };
  }

  private findSeatByClientId(room: Room, clientId: string): Seat | undefined {
    return (['A', 'B'] as PlayerSlot[])
      .map((slot) => room.seats[slot])
      .find((seat): seat is Seat => seat?.clientId === clientId);
  }

  private seatForSocket(socketId: string): { room: Room; seat: Seat } | null {
    const code = this.socketToRoom.get(socketId);
    if (!code) return null;
    const room = this.rooms.get(code);
    if (!room) return null;
    const seat = (['A', 'B'] as PlayerSlot[])
      .map((slot) => room.seats[slot])
      .find((candidate): candidate is Seat => candidate?.socketId === socketId);
    return seat ? { room, seat } : null;
  }

  private allConnected(room: Room): boolean {
    return (['A', 'B'] as PlayerSlot[]).every((slot) => room.seats[slot]?.connected === true);
  }

  private bothSeated(room: Room): boolean {
    return Boolean(room.seats.A && room.seats.B);
  }

  // -------------------------------------------------------------------------
  // Readiness and match start
  // -------------------------------------------------------------------------

  setReady(socketId: string, ready: boolean): void {
    const found = this.seatForSocket(socketId);
    if (!found) return;
    const { room, seat } = found;
    if (room.match?.isLive()) return;

    seat.ready = ready;
    this.pushState(room);

    if (this.bothSeated(room) && room.seats.A?.ready && room.seats.B?.ready) {
      void this.startMatch(room);
    }
  }

  voteRematch(socketId: string): void {
    const found = this.seatForSocket(socketId);
    if (!found) return;
    const { room, seat } = found;
    if (room.match?.isLive()) return;

    seat.rematchVote = true;
    this.pushState(room);

    // The computer always accepts a rematch.
    if (room.vsAi) {
      void this.startMatch(room);
      return;
    }

    if (room.seats.A?.rematchVote && room.seats.B?.rematchVote) {
      void this.startMatch(room);
    }
  }

  /** Builds a fresh match and starts the countdown. */
  private async startMatch(room: Room): Promise<void> {
    const seatA = room.seats.A;
    const seatB = room.seats.B;
    if (!seatA || !seatB) return;
    if (room.match?.isLive()) return;

    // Re-read profiles so upgrades bought between matches take effect.
    await Promise.all(
      [seatA, seatB].map(async (seat) => {
        if (seat.isAi) return;
        const fresh = await this.store.getProfile(seat.profileId);
        if (!fresh) return;
        seat.rawAttributes = { ...fresh.attributes };
        seat.effectiveAttributes = attributesForMode(fresh.attributes, room.mode);
        seat.skinId = fresh.skinId;
        seat.rating = fresh.rating;
        seat.gamesPlayed = fresh.gamesPlayed;
        seat.wins = fresh.wins;
        seat.losses = fresh.losses;
        seat.draws = fresh.draws;
      }),
    );

    if (room.match) {
      this.loop.remove(room.match);
      room.match.dispose();
      room.match = null;
    }

    seatA.ready = false;
    seatB.ready = false;
    seatA.rematchVote = false;
    seatB.rematchVote = false;
    room.lastResult = null;

    const code = room.code;
    const match = new Match({
      code,
      mode: room.mode,
      arenaId: room.arenaId,
      playerA: {
        slot: 'A',
        profileId: seatA.profileId,
        nickname: seatA.nickname,
        attributes: seatA.effectiveAttributes,
      },
      playerB: {
        slot: 'B',
        profileId: seatB.profileId,
        nickname: seatB.nickname,
        attributes: seatB.effectiveAttributes,
      },
      onSnapshot: (snapshot) => this.broadcaster.snapshot(code, snapshot),
      onEvent: (event) => this.broadcaster.matchEvent(code, event),
      onCountdown: (secondsLeft) => this.broadcaster.countdown(code, secondsLeft),
      onStart: (startedAt) => this.broadcaster.matchStart(code, startedAt),
      onFinish: (finish) => {
        void this.handleFinish(code, finish);
      },
      ...(room.aiController
        ? { ai: { slot: 'B' as PlayerSlot, controller: room.aiController } }
        : {}),
    });

    room.match = match;
    match.start(Date.now());
    this.loop.add(match);

    logger.info(
      room.vsAi
        ? `Solo match ${code}: started against the ${room.vsAi} AI on ${room.arenaId}.`
        : `Room ${code}: match started (${room.mode}, arena ${room.arenaId}).`,
    );
    this.pushState(room);
  }

  // -------------------------------------------------------------------------
  // Inputs
  // -------------------------------------------------------------------------

  handleCharge(socketId: string, down: boolean): void {
    const found = this.seatForSocket(socketId);
    if (!found?.room.match) return;
    found.room.match.setCharging(found.seat.slot, down, Date.now());
  }

  handleFire(socketId: string, payload: unknown): void {
    const found = this.seatForSocket(socketId);
    if (!found?.room.match) return;

    const result = found.room.match.fire(found.seat.slot, payload, Date.now());
    if (!result.ok) {
      // Rejections are per-socket, never broadcast - the opponent learns
      // nothing from a cheat attempt or a mistimed click.
      this.broadcaster.error(socketId, { code: result.code, message: result.message });
    }
  }

  // -------------------------------------------------------------------------
  // Disconnect / leave
  // -------------------------------------------------------------------------

  handleDisconnect(socketId: string): void {
    const found = this.seatForSocket(socketId);
    this.socketToRoom.delete(socketId);
    if (!found) return;

    const { room, seat } = found;
    this.broadcaster.detach(socketId, room.code);
    seat.connected = false;
    seat.socketId = null;
    seat.ready = false;

    if (room.match?.isLive()) {
      room.match.pause(Date.now());
      logger.warn(
        `Room ${room.code}: ${seat.nickname} dropped. Holding the seat for ${Math.round(
          RECONNECT_GRACE_MS / 1000,
        )}s.`,
      );
    }

    seat.disconnectTimer = setTimeout(() => {
      seat.disconnectTimer = null;
      if (seat.connected) return;

      if (room.match?.isLive()) {
        logger.warn(`Room ${room.code}: ${seat.nickname} did not return - forfeiting.`);
        room.match.forfeit(seat.slot, Date.now(), 'disconnect');
      } else {
        delete room.seats[seat.slot];
        if (room.vsAi || (!room.seats.A && !room.seats.B)) {
          this.closeRoom(room);
        } else {
          this.pushState(room);
        }
      }
    }, RECONNECT_GRACE_MS);
    seat.disconnectTimer.unref?.();

    this.pushState(room);
  }

  leave(socketId: string, options: { silent?: boolean } = {}): void {
    const found = this.seatForSocket(socketId);
    this.socketToRoom.delete(socketId);
    if (!found) return;

    const { room, seat } = found;
    this.broadcaster.detach(socketId, room.code);

    if (seat.disconnectTimer) {
      clearTimeout(seat.disconnectTimer);
      seat.disconnectTimer = null;
    }

    if (room.match?.isLive()) {
      room.match.forfeit(seat.slot, Date.now(), 'forfeit');
    }

    delete room.seats[seat.slot];

    // A solo room exists only for its one human player.
    if (room.vsAi || (!room.seats.A && !room.seats.B)) {
      this.closeRoom(room);
      return;
    }

    if (!options.silent) this.pushState(room);
  }

  private closeRoom(room: Room): void {
    room.closing = true;
    if (room.match) {
      this.loop.remove(room.match);
      room.match.dispose();
      room.match = null;
    }
    for (const slot of ['A', 'B'] as PlayerSlot[]) {
      const seat = room.seats[slot];
      if (seat?.disconnectTimer) clearTimeout(seat.disconnectTimer);
      if (seat?.socketId) this.socketToRoom.delete(seat.socketId);
    }
    this.rooms.delete(room.code);
    logger.info(`Room ${room.code} closed.`);
  }

  /** Drops rooms that have sat empty, so abandoned codes do not leak worlds. */
  private sweep(): void {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      // An AI seat is always "connected", so only human seats keep a room alive.
      const hasConnected = (['A', 'B'] as PlayerSlot[]).some((slot) => {
        const seat = room.seats[slot];
        return seat?.connected === true && !seat.isAi;
      });
      const stale = now - room.createdAt > RECONNECT_GRACE_MS * 2;
      if (!hasConnected && stale) this.closeRoom(room);
    }
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  /**
   * Settles a Play vs AI match.
   *
   * Coins are paid out at a reduced rate, and that is all. Nothing is written
   * to the match history and nothing reaches the leaderboard, because the
   * opponent is not a stored player - putting a bot on a worldwide board would
   * be exactly the fake entry the board is supposed to be free of. Rating and
   * the win/loss record are untouched for the same reason.
   */
  private async handleSoloFinish(
    room: Room,
    human: Seat,
    ai: Seat,
    finish: MatchFinish,
  ): Promise<void> {
    const profile = await this.store.getProfile(human.profileId);
    if (!profile) {
      logger.error(`Solo match ${room.code}: profile vanished; no coins awarded.`);
      return;
    }

    const humanSlot = human.slot;
    const coins = Math.round(
      computeCoins(finish.outcome, humanSlot, room.mode, finish.hits[humanSlot]) *
        SOLO_COIN_MULTIPLIER,
    );

    const updated = (await this.store.awardCoins(profile.id, coins)) ?? profile;

    const sideFor = (seat: Seat, isHuman: boolean) => ({
      profileId: seat.profileId,
      nickname: seat.nickname,
      ratingBefore: isHuman ? profile.rating : 0,
      ratingAfter: isHuman ? profile.rating : 0,
      ratingDelta: 0,
      coinsEarned: isHuman ? coins : 0,
      hits: finish.hits[seat.slot],
    });

    const result: MatchResultView = {
      outcome: finish.outcome,
      reason: finish.reason,
      mode: room.mode,
      durationMs: finish.durationMs,
      perPlayer: {
        A: sideFor(human.slot === 'A' ? human : ai, human.slot === 'A'),
        B: sideFor(human.slot === 'B' ? human : ai, human.slot === 'B'),
      },
    };

    room.lastResult = result;
    human.rematchVote = false;
    ai.rematchVote = false;

    this.broadcaster.matchOver(room.code, result);
    if (human.socketId) this.broadcaster.profileUpdate(human.socketId, updated);

    logger.info(
      `Solo match ${room.code}: ${
        finish.outcome === 'draw' ? 'draw' : finish.outcome === humanSlot ? 'player wins' : 'AI wins'
      } by ${finish.reason}. ${coins} coins awarded.`,
    );
    this.pushState(room);
  }

  private async handleFinish(code: string, finish: MatchFinish): Promise<void> {
    const room = this.rooms.get(code);
    if (!room) return;

    const seatA = room.seats.A;
    const seatB = room.seats.B;

    if (room.match) this.loop.remove(room.match);

    if (!seatA || !seatB) {
      logger.warn(`Room ${code}: match ended without two seats; nothing persisted.`);
      return;
    }

    if (room.vsAi) {
      await this.handleSoloFinish(room, seatA, seatB, finish);
      return;
    }

    const [profileA, profileB] = await Promise.all([
      this.store.getProfile(seatA.profileId),
      this.store.getProfile(seatB.profileId),
    ]);

    if (!profileA || !profileB) {
      logger.error(`Room ${code}: could not load both profiles; result not saved.`);
      return;
    }

    const ranked = room.mode === 'ranked';
    const elo = ranked
      ? updateElo(
          { rating: profileA.rating, gamesPlayed: profileA.gamesPlayed },
          { rating: profileB.rating, gamesPlayed: profileB.gamesPlayed },
          outcomeToScoreA(finish.outcome),
        )
      : {
          a: { ratingBefore: profileA.rating, ratingAfter: profileA.rating, delta: 0 },
          b: { ratingBefore: profileB.rating, ratingAfter: profileB.rating, delta: 0 },
        };

    const coinsA = computeCoins(finish.outcome, 'A', room.mode, finish.hits.A);
    const coinsB = computeCoins(finish.outcome, 'B', room.mode, finish.hits.B);

    await this.store.recordMatch({
      roomCode: room.code,
      mode: room.mode,
      arenaId: room.arenaId,
      playerAId: profileA.id,
      playerBId: profileB.id,
      playerANickname: profileA.nickname,
      playerBNickname: profileB.nickname,
      outcome: finish.outcome,
      reason: finish.reason,
      ratingADelta: elo.a.delta,
      ratingBDelta: elo.b.delta,
      ratingAAfter: elo.a.ratingAfter,
      ratingBAfter: elo.b.ratingAfter,
      coinsA,
      coinsB,
      durationMs: finish.durationMs,
    });

    const result: MatchResultView = {
      outcome: finish.outcome,
      reason: finish.reason,
      mode: room.mode,
      durationMs: finish.durationMs,
      perPlayer: {
        A: {
          profileId: profileA.id,
          nickname: profileA.nickname,
          ratingBefore: elo.a.ratingBefore,
          ratingAfter: elo.a.ratingAfter,
          ratingDelta: elo.a.delta,
          coinsEarned: coinsA,
          hits: finish.hits.A,
        },
        B: {
          profileId: profileB.id,
          nickname: profileB.nickname,
          ratingBefore: elo.b.ratingBefore,
          ratingAfter: elo.b.ratingAfter,
          ratingDelta: elo.b.delta,
          coinsEarned: coinsB,
          hits: finish.hits.B,
        },
      },
    };

    room.lastResult = result;
    seatA.rematchVote = false;
    seatB.rematchVote = false;

    this.broadcaster.matchOver(room.code, result);

    // Push each player their own updated wallet and record.
    for (const seat of [seatA, seatB]) {
      const refreshed = await this.store.getProfile(seat.profileId);
      if (!refreshed) continue;
      seat.rating = refreshed.rating;
      seat.gamesPlayed = refreshed.gamesPlayed;
      seat.wins = refreshed.wins;
      seat.losses = refreshed.losses;
      seat.draws = refreshed.draws;
      if (seat.socketId) this.broadcaster.profileUpdate(seat.socketId, refreshed);
    }

    logger.info(
      `Room ${room.code}: ${finish.outcome === 'draw' ? 'draw' : `${finish.outcome} wins`} by ${finish.reason}.`,
    );
    this.pushState(room);
  }

  // -------------------------------------------------------------------------
  // Views
  // -------------------------------------------------------------------------

  view(room: Room): RoomView {
    const players = (['A', 'B'] as PlayerSlot[])
      .map((slot) => room.seats[slot])
      .filter((seat): seat is Seat => Boolean(seat))
      .map((seat) => ({
        slot: seat.slot,
        profile: toPublic(seat),
        connected: seat.connected,
        ready: seat.ready,
        rematchVote: seat.rematchVote,
        effectiveAttributes: seat.effectiveAttributes,
        isAi: seat.isAi,
      }));

    return {
      code: room.code,
      mode: room.mode,
      arenaId: room.arenaId,
      phase: room.match?.getPhase() ?? 'waiting',
      hostSlot: room.hostSlot,
      players,
      inviteUrl: buildInviteUrl(this.publicUrl, room.code),
      lastResult: room.lastResult,
      vsAi: room.vsAi,
    };
  }

  viewByCode(code: string): RoomView | null {
    const room = this.rooms.get(code);
    return room ? this.view(room) : null;
  }

  private pushState(room: Room): void {
    if (room.closing) return;
    this.broadcaster.roomState(room.code, this.view(room));
  }
}
