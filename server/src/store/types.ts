import type {
  AttributeKey,
  GameMode,
  LeaderboardPeriod,
  LeaderboardRow,
  LeaderboardSort,
  MatchOutcome,
  MatchRecord,
  PlayerProfile,
  StorageStatus,
} from '@pfa/shared';

export interface CreateProfileInput {
  clientId: string;
  nickname: string;
  secret: string;
}

export interface AuthenticatedProfile {
  profile: PlayerProfile;
  /** Only present the first time a profile is created. */
  issuedSecret: string | null;
}

export interface RecordMatchInput {
  roomCode: string;
  mode: GameMode;
  arenaId: string;
  playerAId: string;
  playerBId: string;
  playerANickname: string;
  playerBNickname: string;
  outcome: MatchOutcome;
  reason: MatchRecord['reason'];
  ratingADelta: number;
  ratingBDelta: number;
  ratingAAfter: number;
  ratingBAfter: number;
  coinsA: number;
  coinsB: number;
  durationMs: number;
}

export interface LeaderboardQuery {
  period: LeaderboardPeriod;
  sort: LeaderboardSort;
  limit: number;
}

/**
 * Everything the game needs from persistence.
 *
 * Two implementations ship: PostgreSQL via Prisma (real, shared, worldwide) and
 * a local JSON file (single machine, development only). Both satisfy this
 * interface exactly, and `status()` makes the difference visible to the player
 * rather than hiding it.
 */
export interface Store {
  status(): StorageStatus;
  init(): Promise<void>;
  close(): Promise<void>;

  /**
   * Finds the profile for a client id, verifying the secret, or creates a new
   * one. Returns null when the secret does not match an existing profile.
   */
  authenticate(input: CreateProfileInput): Promise<AuthenticatedProfile | null>;

  getProfile(id: string): Promise<PlayerProfile | null>;
  getProfileByClientId(clientId: string): Promise<PlayerProfile | null>;
  verifySecret(profileId: string, secret: string): Promise<boolean>;

  setNickname(profileId: string, nickname: string): Promise<PlayerProfile | null>;
  /** Spends coins and raises one attribute by a level. */
  purchaseUpgrade(profileId: string, attribute: AttributeKey): Promise<PlayerProfile | null>;
  /** Buys the skin if it is not owned yet, then equips it. */
  purchaseOrEquipSkin(profileId: string, skinId: string): Promise<PlayerProfile | null>;

  /**
   * Adds coins without recording a match. Used by Play vs AI, which pays out
   * but is deliberately kept out of the match history and the leaderboard -
   * a bot is not a stored player.
   */
  awardCoins(profileId: string, amount: number): Promise<PlayerProfile | null>;

  recordMatch(input: RecordMatchInput): Promise<MatchRecord>;
  getMatchHistory(profileId: string, limit: number): Promise<MatchRecord[]>;
  leaderboard(query: LeaderboardQuery): Promise<LeaderboardRow[]>;
  countProfiles(): Promise<number>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}
