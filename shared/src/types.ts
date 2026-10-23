import type { Quat, Vec3 } from './math.js';

export type PlayerSlot = 'A' | 'B';
export type GameMode = 'casual' | 'ranked';

/**
 * Difficulty of the computer opponent. Declared here rather than in ai.ts so
 * the protocol types do not depend on the AI implementation.
 */
export type AiDifficulty = 'easy' | 'medium' | 'hard';

export type MatchPhase =
  | 'waiting'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'finished';

export type MatchOutcome = 'A' | 'B' | 'draw';

export type EliminationReason = 'fell' | 'out_of_bounds' | 'forfeit' | 'disconnect';

export type AttributeKey = 'impact' | 'stability' | 'control' | 'recovery';

export interface PenAttributes {
  impact: number;
  stability: number;
  control: number;
  recovery: number;
}

export interface PlayerProfile {
  id: string;
  /** Stable per-browser identity used for reconnection and progression. */
  clientId: string;
  nickname: string;
  rating: number;
  coins: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  attributes: PenAttributes;
  skinId: string;
  ownedSkins: string[];
  createdAt: string;
  updatedAt: string;
}

/** Public view of a profile - what other players are allowed to see. */
export interface PublicProfile {
  id: string;
  nickname: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  skinId: string;
}

export interface MatchRecord {
  id: string;
  roomCode: string;
  mode: GameMode;
  arenaId: string;
  playerAId: string;
  playerBId: string;
  playerANickname: string;
  playerBNickname: string;
  outcome: MatchOutcome;
  reason: EliminationReason | 'time';
  ratingADelta: number;
  ratingBDelta: number;
  ratingAAfter: number;
  ratingBAfter: number;
  durationMs: number;
  playedAt: string;
}

export type LeaderboardPeriod = 'all' | 'weekly' | 'monthly';
export type LeaderboardSort = 'rating' | 'wins';

export interface LeaderboardRow {
  rank: number;
  profileId: string;
  nickname: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  /** Rating gained inside the selected window (0 for the all-time board). */
  ratingGain: number;
}

export interface LeaderboardResponse {
  period: LeaderboardPeriod;
  sort: LeaderboardSort;
  /** Which storage backend produced these rows - surfaced in the UI, never guessed. */
  storage: StorageKind;
  rows: LeaderboardRow[];
  generatedAt: string;
}

export type StorageKind = 'postgres' | 'local-json';

export interface StorageStatus {
  kind: StorageKind;
  persistent: boolean;
  /** Plain-language description shown in the UI so local data is never passed off as global. */
  description: string;
}

// ---------------------------------------------------------------------------
// Live match state
// ---------------------------------------------------------------------------

export interface PenState {
  slot: PlayerSlot;
  position: Vec3;
  rotation: Quat;
  /** Linear speed in units per second, used for impact sounds and HUD feedback. */
  speed: number;
  charging: boolean;
  chargePower: number;
  /** Server timestamp (ms) at which this pen may fire again. */
  nextFireAt: number;
  eliminated: boolean;
  eliminationReason: EliminationReason | null;
  /** Milliseconds left before an out-of-bounds pen is eliminated; null when safe. */
  graceLeftMs: number | null;
}

export interface ValidArea {
  halfX: number;
  halfZ: number;
}

export interface Snapshot {
  /** Monotonic snapshot sequence number. */
  seq: number;
  /** Server clock in milliseconds when this snapshot was produced. */
  t: number;
  phase: MatchPhase;
  /** Milliseconds remaining in the match. */
  timeLeftMs: number;
  area: ValidArea;
  pens: PenState[];
}

export interface RoomPlayerView {
  slot: PlayerSlot;
  profile: PublicProfile;
  connected: boolean;
  ready: boolean;
  rematchVote: boolean;
  /** Attributes actually in force this match (normalised in ranked). */
  effectiveAttributes: PenAttributes;
  /** True for the computer opponent in a Play vs AI match. */
  isAi: boolean;
}

export interface RoomView {
  code: string;
  mode: GameMode;
  arenaId: string;
  phase: MatchPhase;
  hostSlot: PlayerSlot;
  players: RoomPlayerView[];
  inviteUrl: string;
  /** Present once a match has finished. */
  lastResult: MatchResultView | null;
  /**
   * Difficulty of the computer opponent when this is a single-player match,
   * or null for an ordinary online room. The client uses it to skip the lobby
   * and to offer "play again" instead of a rematch vote.
   */
  vsAi: AiDifficulty | null;
}

export interface MatchResultView {
  outcome: MatchOutcome;
  reason: EliminationReason | 'time';
  mode: GameMode;
  durationMs: number;
  perPlayer: Record<
    PlayerSlot,
    {
      profileId: string;
      nickname: string;
      ratingBefore: number;
      ratingAfter: number;
      ratingDelta: number;
      coinsEarned: number;
      hits: number;
    }
  >;
}

export type MatchEventType =
  | 'charge_start'
  | 'fire'
  | 'pen_hit'
  | 'desk_hit'
  | 'fell'
  | 'danger_enter'
  | 'danger_exit';

export interface MatchEvent {
  type: MatchEventType;
  slot: PlayerSlot;
  /** Normalised 0..1 intensity, used to scale sound effects. */
  intensity: number;
  t: number;
}

// ---------------------------------------------------------------------------
// Socket protocol
// ---------------------------------------------------------------------------

export interface AuthPayload {
  clientId: string;
  nickname: string;
  /**
   * Ownership token for this profile. The server issues one the first time a
   * clientId is seen and stores only its hash; later sessions must present it
   * to reclaim the profile. It is what stops anyone who learns your clientId
   * from spending your coins or playing on your rating.
   */
  secret?: string;
}

export interface CreateRoomPayload {
  mode: GameMode;
  arenaId: string;
}

export interface JoinRoomPayload {
  code: string;
}

export interface StartSoloPayload {
  difficulty: AiDifficulty;
  arenaId: string;
}

export interface FirePayload {
  /** Aim direction in the XZ plane. The server re-normalises it. */
  dirX: number;
  dirZ: number;
  /** Charge level in the 0..1 range. The server clamps it. */
  power: number;
}

export interface ChargePayload {
  down: boolean;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface ClientToServerEvents {
  auth: (payload: AuthPayload, ack: (result: AuthResult) => void) => void;
  'room:create': (payload: CreateRoomPayload, ack: (result: RoomResult) => void) => void;
  'room:join': (payload: JoinRoomPayload, ack: (result: RoomResult) => void) => void;
  /**
   * Starts a single-player match against the computer. No room code, no
   * invitation and no second client: the server seats an AI opponent and the
   * countdown begins at once.
   */
  'solo:start': (payload: StartSoloPayload, ack: (result: RoomResult) => void) => void;
  'room:leave': () => void;
  'room:ready': (ready: boolean) => void;
  'input:charge': (payload: ChargePayload) => void;
  'input:fire': (payload: FirePayload) => void;
  'rematch:vote': () => void;
  'net:ping': (clientTime: number, ack: (serverTime: number) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (room: RoomView) => void;
  'match:countdown': (secondsLeft: number) => void;
  'match:start': (startedAt: number) => void;
  snapshot: (snapshot: Snapshot) => void;
  'match:event': (event: MatchEvent) => void;
  'match:over': (result: MatchResultView) => void;
  'profile:update': (profile: PlayerProfile) => void;
  'server:error': (payload: ErrorPayload) => void;
}

export type AuthResult =
  | {
      ok: true;
      profile: PlayerProfile;
      storage: StorageStatus;
      /** Only returned once, when the profile is first created. */
      secret: string | null;
      /** Room code to rejoin after a reload or dropout, if one is waiting. */
      rejoinRoom: string | null;
      /** Server clock, so the client can align its interpolation delay. */
      serverTime: number;
    }
  | { ok: false; error: ErrorPayload };

export type RoomResult =
  | { ok: true; room: RoomView; slot: PlayerSlot }
  | { ok: false; error: ErrorPayload };

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

export interface ArenaPreset {
  id: string;
  name: string;
  description: string;
  /** drei <Sky> parameters. */
  sky: {
    turbidity: number;
    rayleigh: number;
    mieCoefficient: number;
    mieDirectionalG: number;
    /** Sun direction as [x, y, z]; y below ~0.05 reads as dusk. */
    sunPosition: [number, number, number];
  };
  fog: { color: string; near: number; far: number };
  grass: { base: string; accent: string };
  trees: { trunk: string; canopy: string; count: number };
  desk: { wood: string; grain: string; metal: string };
  lights: {
    ambient: { color: string; intensity: number };
    hemisphere: { sky: string; ground: string; intensity: number };
    sun: { color: string; intensity: number; position: [number, number, number] };
  };
}

export interface PenSkin {
  id: string;
  name: string;
  cost: number;
  barrel: string;
  grip: string;
  cap: string;
  accent: string;
  metalness: number;
  roughness: number;
  stripes: boolean;
}
