import { createHash, randomUUID } from 'node:crypto';

import {
  DEFAULT_SKIN_ID,
  FREE_SKIN_IDS,
  MAX_ATTRIBUTE_LEVEL,
  PEN_SKINS,
  STARTING_COINS,
  STARTING_RATING,
  sanitizeAttributes,
  upgradeCost,
} from '@pfa/shared';
import type {
  AttributeKey,
  LeaderboardRow,
  MatchOutcome,
  MatchRecord,
  PlayerProfile,
  StorageStatus,
} from '@pfa/shared';

import { logger } from '../logger.js';
import type {
  AuthenticatedProfile,
  CreateProfileInput,
  LeaderboardQuery,
  RecordMatchInput,
  Store,
} from './types.js';

/**
 * Minimal structural view of the generated Prisma client.
 *
 * The real client is only generated once `prisma generate` has run against a
 * schema. Importing its types statically would make `npm run typecheck` fail on
 * a fresh clone where nobody has configured PostgreSQL yet, so this file
 * describes the handful of calls it makes and loads the module at runtime.
 */
interface PrismaDelegate {
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  create(args: unknown): Promise<Record<string, unknown>>;
  update(args: unknown): Promise<Record<string, unknown>>;
  updateMany(args: unknown): Promise<{ count: number }>;
  count(args?: unknown): Promise<number>;
}

interface PrismaLike {
  profile: PrismaDelegate;
  match: PrismaDelegate;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction(operations: unknown[]): Promise<unknown[]>;
}

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asDateIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date().toISOString();
}

function rowToProfile(row: Record<string, unknown>): PlayerProfile {
  const ownedRaw = Array.isArray(row.ownedSkins) ? (row.ownedSkins as unknown[]) : [];
  const owned = Array.from(
    new Set(ownedRaw.filter((item): item is string => typeof item === 'string')),
  );

  return {
    id: asString(row.id),
    clientId: asString(row.clientId),
    nickname: asString(row.nickname, 'Player'),
    rating: asNumber(row.rating, STARTING_RATING),
    coins: asNumber(row.coins, STARTING_COINS),
    wins: asNumber(row.wins),
    losses: asNumber(row.losses),
    draws: asNumber(row.draws),
    gamesPlayed: asNumber(row.gamesPlayed),
    attributes: sanitizeAttributes({
      impact: asNumber(row.impact),
      stability: asNumber(row.stability),
      control: asNumber(row.control),
      recovery: asNumber(row.recovery),
    }),
    skinId: asString(row.skinId, DEFAULT_SKIN_ID),
    ownedSkins: owned.length > 0 ? owned : [...FREE_SKIN_IDS],
    createdAt: asDateIso(row.createdAt),
    updatedAt: asDateIso(row.updatedAt),
  };
}

function rowToMatch(row: Record<string, unknown>): MatchRecord {
  return {
    id: asString(row.id),
    roomCode: asString(row.roomCode),
    mode: asString(row.mode) === 'ranked' ? 'ranked' : 'casual',
    arenaId: asString(row.arenaId),
    playerAId: asString(row.playerAId),
    playerBId: asString(row.playerBId),
    playerANickname: asString(row.playerANickname),
    playerBNickname: asString(row.playerBNickname),
    outcome: asString(row.outcome) as MatchOutcome,
    reason: asString(row.reason) as MatchRecord['reason'],
    ratingADelta: asNumber(row.ratingADelta),
    ratingBDelta: asNumber(row.ratingBDelta),
    ratingAAfter: asNumber(row.ratingAAfter),
    ratingBAfter: asNumber(row.ratingBAfter),
    durationMs: asNumber(row.durationMs),
    playedAt: asDateIso(row.playedAt),
  };
}

const ATTRIBUTE_COLUMN: Record<AttributeKey, string> = {
  impact: 'impact',
  stability: 'stability',
  control: 'control',
  recovery: 'recovery',
};

/** Loads the generated Prisma client, or null when it is unavailable. */
export async function createPrismaClient(databaseUrl: string): Promise<PrismaLike | null> {
  try {
    // Indirect specifier: keeps TypeScript from demanding generated types at build time.
    const moduleName = '@prisma/client';
    const loaded = (await import(moduleName)) as {
      PrismaClient?: new (options?: unknown) => unknown;
    };

    if (!loaded.PrismaClient) {
      logger.warn('@prisma/client loaded but exposes no PrismaClient export.');
      return null;
    }

    const client = new loaded.PrismaClient({
      datasources: { db: { url: databaseUrl } },
      log: ['warn', 'error'],
    }) as unknown as PrismaLike;

    await client.$connect();
    return client;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`PostgreSQL is not usable right now: ${message}`);
    return null;
  }
}

/** PostgreSQL-backed storage. Real accounts, real worldwide rankings. */
export class PrismaStore implements Store {
  constructor(private readonly client: PrismaLike) {}

  status(): StorageStatus {
    return {
      kind: 'postgres',
      persistent: true,
      description:
        'PostgreSQL database. Accounts, match history and rankings are shared by every player on this deployment.',
    };
  }

  async init(): Promise<void> {
    await this.client.profile.count();
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }

  async authenticate(input: CreateProfileInput): Promise<AuthenticatedProfile | null> {
    const existing = await this.client.profile.findUnique({
      where: { clientId: input.clientId },
    });

    if (existing) {
      if (asString(existing.secretHash) !== hashSecret(input.secret)) return null;

      if (input.nickname && input.nickname !== asString(existing.nickname)) {
        const updated = await this.client.profile.update({
          where: { id: asString(existing.id) },
          data: { nickname: input.nickname },
        });
        return { profile: rowToProfile(updated), issuedSecret: null };
      }

      return { profile: rowToProfile(existing), issuedSecret: null };
    }

    const created = await this.client.profile.create({
      data: {
        id: randomUUID(),
        clientId: input.clientId,
        secretHash: hashSecret(input.secret),
        nickname: input.nickname,
        rating: STARTING_RATING,
        coins: STARTING_COINS,
        skinId: DEFAULT_SKIN_ID,
        ownedSkins: [...FREE_SKIN_IDS],
      },
    });

    return { profile: rowToProfile(created), issuedSecret: input.secret };
  }

  async getProfile(id: string): Promise<PlayerProfile | null> {
    const row = await this.client.profile.findUnique({ where: { id } });
    return row ? rowToProfile(row) : null;
  }

  async getProfileByClientId(clientId: string): Promise<PlayerProfile | null> {
    const row = await this.client.profile.findUnique({ where: { clientId } });
    return row ? rowToProfile(row) : null;
  }

  async verifySecret(profileId: string, secret: string): Promise<boolean> {
    const row = await this.client.profile.findUnique({ where: { id: profileId } });
    if (!row) return false;
    return asString(row.secretHash) === hashSecret(secret);
  }

  async setNickname(profileId: string, nickname: string): Promise<PlayerProfile | null> {
    const updated = await this.client.profile.update({
      where: { id: profileId },
      data: { nickname },
    });
    return rowToProfile(updated);
  }

  /**
   * Buys one attribute level.
   *
   * The guard lives in the WHERE clause so the balance check and the spend are
   * a single atomic statement - two tabs clicking Upgrade at once cannot push
   * the balance negative or buy the same level twice.
   */
  async purchaseUpgrade(profileId: string, attribute: AttributeKey): Promise<PlayerProfile | null> {
    const row = await this.client.profile.findUnique({ where: { id: profileId } });
    if (!row) return null;

    const column = ATTRIBUTE_COLUMN[attribute];
    const current = asNumber(row[column]);
    if (current >= MAX_ATTRIBUTE_LEVEL) return null;

    const cost = upgradeCost(attribute, current);
    if (cost === null) return null;

    const result = await this.client.profile.updateMany({
      where: {
        id: profileId,
        coins: { gte: cost },
        [column]: current,
      },
      data: {
        coins: { decrement: cost },
        [column]: { increment: 1 },
      },
    });

    if (result.count === 0) return null;
    return this.getProfile(profileId);
  }

  async purchaseOrEquipSkin(profileId: string, skinId: string): Promise<PlayerProfile | null> {
    const skin = PEN_SKINS.find((candidate) => candidate.id === skinId);
    if (!skin) return null;

    const row = await this.client.profile.findUnique({ where: { id: profileId } });
    if (!row) return null;

    const owned = Array.isArray(row.ownedSkins)
      ? (row.ownedSkins as unknown[]).filter((item): item is string => typeof item === 'string')
      : [];

    if (owned.includes(skinId)) {
      const updated = await this.client.profile.update({
        where: { id: profileId },
        data: { skinId },
      });
      return rowToProfile(updated);
    }

    const result = await this.client.profile.updateMany({
      where: { id: profileId, coins: { gte: skin.cost } },
      data: {
        coins: { decrement: skin.cost },
        skinId,
        ownedSkins: { push: skinId },
      },
    });

    if (result.count === 0) return null;
    return this.getProfile(profileId);
  }

  async awardCoins(profileId: string, amount: number): Promise<PlayerProfile | null> {
    const rounded = Math.round(amount);
    if (rounded === 0) return this.getProfile(profileId);

    const result = await this.client.profile.updateMany({
      where: { id: profileId },
      data: { coins: { increment: rounded } },
    });
    if (result.count === 0) return null;
    return this.getProfile(profileId);
  }

  /** Writes the match row and both rating/coin updates in one transaction. */
  async recordMatch(input: RecordMatchInput): Promise<MatchRecord> {
    const matchId = randomUUID();

    const statsFor = (outcome: MatchOutcome, slot: 'A' | 'B') => ({
      wins: outcome === slot ? 1 : 0,
      losses: outcome !== 'draw' && outcome !== slot ? 1 : 0,
      draws: outcome === 'draw' ? 1 : 0,
    });

    const a = statsFor(input.outcome, 'A');
    const b = statsFor(input.outcome, 'B');

    const operations = [
      this.client.match.create({
        data: {
          id: matchId,
          roomCode: input.roomCode,
          mode: input.mode,
          arenaId: input.arenaId,
          playerAId: input.playerAId,
          playerBId: input.playerBId,
          playerANickname: input.playerANickname,
          playerBNickname: input.playerBNickname,
          outcome: input.outcome,
          reason: input.reason,
          ratingADelta: input.ratingADelta,
          ratingBDelta: input.ratingBDelta,
          ratingAAfter: input.ratingAAfter,
          ratingBAfter: input.ratingBAfter,
          durationMs: input.durationMs,
        },
      }),
      this.client.profile.update({
        where: { id: input.playerAId },
        data: {
          rating: input.ratingAAfter,
          coins: { increment: input.coinsA },
          gamesPlayed: { increment: 1 },
          wins: { increment: a.wins },
          losses: { increment: a.losses },
          draws: { increment: a.draws },
        },
      }),
      this.client.profile.update({
        where: { id: input.playerBId },
        data: {
          rating: input.ratingBAfter,
          coins: { increment: input.coinsB },
          gamesPlayed: { increment: 1 },
          wins: { increment: b.wins },
          losses: { increment: b.losses },
          draws: { increment: b.draws },
        },
      }),
    ];

    const [created] = await this.client.$transaction(operations);
    return rowToMatch((created ?? {}) as Record<string, unknown>);
  }

  async getMatchHistory(profileId: string, limit: number): Promise<MatchRecord[]> {
    const rows = await this.client.match.findMany({
      where: { OR: [{ playerAId: profileId }, { playerBId: profileId }] },
      orderBy: { playedAt: 'desc' },
      take: Math.max(0, limit),
    });
    return rows.map(rowToMatch);
  }

  async leaderboard(query: LeaderboardQuery): Promise<LeaderboardRow[]> {
    if (query.period === 'all') {
      const rows = await this.client.profile.findMany({
        where: { gamesPlayed: { gt: 0 } },
        orderBy:
          query.sort === 'wins'
            ? [{ wins: 'desc' }, { rating: 'desc' }]
            : [{ rating: 'desc' }, { wins: 'desc' }],
        take: Math.max(0, query.limit),
      });

      return rows.map((row, index): LeaderboardRow => {
        const profile = rowToProfile(row);
        return {
          rank: index + 1,
          profileId: profile.id,
          nickname: profile.nickname,
          rating: profile.rating,
          wins: profile.wins,
          losses: profile.losses,
          draws: profile.draws,
          gamesPlayed: profile.gamesPlayed,
          ratingGain: 0,
        };
      });
    }

    const days = query.period === 'weekly' ? 7 : 30;
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const matches = await this.client.match.findMany({
      where: { playedAt: { gte: cutoff } },
    });

    interface Accumulator {
      wins: number;
      losses: number;
      draws: number;
      games: number;
      ratingGain: number;
    }

    const totals = new Map<string, Accumulator>();
    const bump = (id: string, won: boolean, lost: boolean, drew: boolean, delta: number): void => {
      const entry = totals.get(id) ?? { wins: 0, losses: 0, draws: 0, games: 0, ratingGain: 0 };
      entry.games += 1;
      if (won) entry.wins += 1;
      if (lost) entry.losses += 1;
      if (drew) entry.draws += 1;
      entry.ratingGain += delta;
      totals.set(id, entry);
    };

    for (const raw of matches) {
      const match = rowToMatch(raw);
      bump(
        match.playerAId,
        match.outcome === 'A',
        match.outcome === 'B',
        match.outcome === 'draw',
        match.ratingADelta,
      );
      bump(
        match.playerBId,
        match.outcome === 'B',
        match.outcome === 'A',
        match.outcome === 'draw',
        match.ratingBDelta,
      );
    }

    if (totals.size === 0) return [];

    const profiles = await this.client.profile.findMany({
      where: { id: { in: Array.from(totals.keys()) } },
    });

    const rows = profiles.map((raw) => {
      const profile = rowToProfile(raw);
      const stats = totals.get(profile.id);
      return {
        profileId: profile.id,
        nickname: profile.nickname,
        rating: profile.rating,
        wins: stats?.wins ?? 0,
        losses: stats?.losses ?? 0,
        draws: stats?.draws ?? 0,
        gamesPlayed: stats?.games ?? 0,
        ratingGain: stats?.ratingGain ?? 0,
      };
    });

    rows.sort((x, y) => {
      if (query.sort === 'wins') {
        if (y.wins !== x.wins) return y.wins - x.wins;
        return y.rating - x.rating;
      }
      if (y.ratingGain !== x.ratingGain) return y.ratingGain - x.ratingGain;
      return y.rating - x.rating;
    });

    return rows
      .slice(0, Math.max(0, query.limit))
      .map((row, index): LeaderboardRow => ({ rank: index + 1, ...row }));
  }

  async countProfiles(): Promise<number> {
    return this.client.profile.count();
  }
}
