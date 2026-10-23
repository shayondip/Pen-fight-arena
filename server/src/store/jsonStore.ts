import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

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

interface StoredProfile extends PlayerProfile {
  secretHash: string;
}

interface StoreFile {
  version: 1;
  profiles: StoredProfile[];
  matches: MatchRecord[];
}

const EMPTY_FILE: StoreFile = { version: 1, profiles: [], matches: [] };

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

function nowIso(): string {
  return new Date().toISOString();
}

function publicise(profile: StoredProfile): PlayerProfile {
  const { secretHash: _secretHash, ...rest } = profile;
  return { ...rest, attributes: { ...rest.attributes }, ownedSkins: [...rest.ownedSkins] };
}

function periodStart(period: LeaderboardQuery['period'], from: number): number | null {
  if (period === 'weekly') return from - 7 * 24 * 60 * 60 * 1000;
  if (period === 'monthly') return from - 30 * 24 * 60 * 60 * 1000;
  return null;
}

/**
 * Local development storage.
 *
 * Writes a single JSON file under the server's data directory. It is real
 * persistence across restarts on one machine, and it is deliberately labelled
 * as local-only everywhere it surfaces - a leaderboard built from this file is
 * a leaderboard of whoever has played on this computer, not a worldwide one.
 */
export class JsonStore implements Store {
  private data: StoreFile = structuredClone(EMPTY_FILE);
  private readonly filePath: string;
  private writeQueue: Promise<void> = Promise.resolve();
  private dirty = false;
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(dataDir: string) {
    this.filePath = resolve(join(dataDir, 'dev-store.json'));
  }

  status(): StorageStatus {
    return {
      kind: 'local-json',
      persistent: true,
      description:
        'Local development storage (JSON file on this machine). Progress and rankings are saved, but they are visible only to players using this server.',
    };
  }

  async init(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    if (existsSync(this.filePath)) {
      try {
        const raw = await readFile(this.filePath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<StoreFile>;
        this.data = {
          version: 1,
          profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
          matches: Array.isArray(parsed.matches) ? parsed.matches : [],
        };
        logger.info(
          `Local store loaded: ${this.data.profiles.length} profile(s), ${this.data.matches.length} match(es).`,
        );
      } catch (error) {
        logger.error(`Could not parse ${this.filePath}; starting from an empty store.`, error);
        this.data = structuredClone(EMPTY_FILE);
      }
    } else {
      await this.flush();
      logger.info(`Local store created at ${this.filePath}`);
    }
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    await this.writeQueue;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, 150);
    // Never hold the process open just to save a dev file.
    this.flushTimer.unref?.();
  }

  /** Writes to a temporary file and renames it, so a crash cannot truncate the store. */
  private async flush(): Promise<void> {
    if (!this.dirty && existsSync(this.filePath)) return;
    this.dirty = false;
    const payload = JSON.stringify(this.data, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(tmp, payload, 'utf8');
      await rename(tmp, this.filePath);
    });
    await this.writeQueue;
  }

  private findByClientId(clientId: string): StoredProfile | undefined {
    return this.data.profiles.find((profile) => profile.clientId === clientId);
  }

  private findById(id: string): StoredProfile | undefined {
    return this.data.profiles.find((profile) => profile.id === id);
  }

  async authenticate(input: CreateProfileInput): Promise<AuthenticatedProfile | null> {
    const existing = this.findByClientId(input.clientId);

    if (existing) {
      if (existing.secretHash !== hashSecret(input.secret)) return null;
      if (input.nickname && input.nickname !== existing.nickname) {
        existing.nickname = input.nickname;
        existing.updatedAt = nowIso();
        this.markDirty();
      }
      return { profile: publicise(existing), issuedSecret: null };
    }

    const created: StoredProfile = {
      id: randomUUID(),
      clientId: input.clientId,
      secretHash: hashSecret(input.secret),
      nickname: input.nickname,
      rating: STARTING_RATING,
      coins: STARTING_COINS,
      wins: 0,
      losses: 0,
      draws: 0,
      gamesPlayed: 0,
      attributes: { impact: 0, stability: 0, control: 0, recovery: 0 },
      skinId: DEFAULT_SKIN_ID,
      ownedSkins: [...FREE_SKIN_IDS],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };

    this.data.profiles.push(created);
    this.markDirty();
    return { profile: publicise(created), issuedSecret: input.secret };
  }

  async getProfile(id: string): Promise<PlayerProfile | null> {
    const found = this.findById(id);
    return found ? publicise(found) : null;
  }

  async getProfileByClientId(clientId: string): Promise<PlayerProfile | null> {
    const found = this.findByClientId(clientId);
    return found ? publicise(found) : null;
  }

  async verifySecret(profileId: string, secret: string): Promise<boolean> {
    const found = this.findById(profileId);
    if (!found) return false;
    return found.secretHash === hashSecret(secret);
  }

  async setNickname(profileId: string, nickname: string): Promise<PlayerProfile | null> {
    const found = this.findById(profileId);
    if (!found) return null;
    found.nickname = nickname;
    found.updatedAt = nowIso();
    this.markDirty();
    return publicise(found);
  }

  async purchaseUpgrade(profileId: string, attribute: AttributeKey): Promise<PlayerProfile | null> {
    const found = this.findById(profileId);
    if (!found) return null;

    const attributes = sanitizeAttributes(found.attributes);
    const current = attributes[attribute];
    if (current >= MAX_ATTRIBUTE_LEVEL) return null;

    const cost = upgradeCost(attribute, current);
    if (cost === null || found.coins < cost) return null;

    found.coins -= cost;
    attributes[attribute] = current + 1;
    found.attributes = attributes;
    found.updatedAt = nowIso();
    this.markDirty();
    return publicise(found);
  }

  async purchaseOrEquipSkin(profileId: string, skinId: string): Promise<PlayerProfile | null> {
    const found = this.findById(profileId);
    if (!found) return null;

    const skin = PEN_SKINS.find((candidate) => candidate.id === skinId);
    if (!skin) return null;

    if (!found.ownedSkins.includes(skinId)) {
      if (found.coins < skin.cost) return null;
      found.coins -= skin.cost;
      found.ownedSkins = [...found.ownedSkins, skinId];
    }

    found.skinId = skinId;
    found.updatedAt = nowIso();
    this.markDirty();
    return publicise(found);
  }

  async awardCoins(profileId: string, amount: number): Promise<PlayerProfile | null> {
    const found = this.findById(profileId);
    if (!found) return null;
    found.coins = Math.max(0, found.coins + Math.round(amount));
    found.updatedAt = nowIso();
    this.markDirty();
    return publicise(found);
  }

  async recordMatch(input: RecordMatchInput): Promise<MatchRecord> {
    const record: MatchRecord = {
      id: randomUUID(),
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
      playedAt: nowIso(),
    };

    this.data.matches.push(record);

    const applyTo = (
      profileId: string,
      won: boolean,
      lost: boolean,
      drew: boolean,
      ratingAfter: number,
      coins: number,
    ): void => {
      const profile = this.findById(profileId);
      if (!profile) return;
      profile.gamesPlayed += 1;
      if (won) profile.wins += 1;
      if (lost) profile.losses += 1;
      if (drew) profile.draws += 1;
      profile.rating = ratingAfter;
      profile.coins += coins;
      profile.updatedAt = nowIso();
    };

    applyTo(
      input.playerAId,
      input.outcome === 'A',
      input.outcome === 'B',
      input.outcome === 'draw',
      input.ratingAAfter,
      input.coinsA,
    );
    applyTo(
      input.playerBId,
      input.outcome === 'B',
      input.outcome === 'A',
      input.outcome === 'draw',
      input.ratingBAfter,
      input.coinsB,
    );

    this.markDirty();
    return record;
  }

  async getMatchHistory(profileId: string, limit: number): Promise<MatchRecord[]> {
    return this.data.matches
      .filter((match) => match.playerAId === profileId || match.playerBId === profileId)
      .sort((a, b) => Date.parse(b.playedAt) - Date.parse(a.playedAt))
      .slice(0, Math.max(0, limit));
  }

  async leaderboard(query: LeaderboardQuery): Promise<LeaderboardRow[]> {
    const cutoff = periodStart(query.period, Date.now());

    interface Accumulator {
      wins: number;
      losses: number;
      draws: number;
      games: number;
      ratingGain: number;
    }

    const windowed = new Map<string, Accumulator>();

    if (cutoff !== null) {
      for (const match of this.data.matches) {
        if (Date.parse(match.playedAt) < cutoff) continue;

        const bump = (id: string, won: boolean, lost: boolean, drew: boolean, delta: number) => {
          const entry = windowed.get(id) ?? {
            wins: 0,
            losses: 0,
            draws: 0,
            games: 0,
            ratingGain: 0,
          };
          entry.games += 1;
          if (won) entry.wins += 1;
          if (lost) entry.losses += 1;
          if (drew) entry.draws += 1;
          entry.ratingGain += delta;
          windowed.set(id, entry);
        };

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
    }

    // Only ever list real stored profiles - the board is empty until people play.
    const candidates = this.data.profiles.filter((profile) =>
      cutoff === null ? profile.gamesPlayed > 0 : windowed.has(profile.id),
    );

    const rows = candidates.map((profile) => {
      const stats = windowed.get(profile.id);
      return {
        profileId: profile.id,
        nickname: profile.nickname,
        rating: profile.rating,
        wins: cutoff === null ? profile.wins : (stats?.wins ?? 0),
        losses: cutoff === null ? profile.losses : (stats?.losses ?? 0),
        draws: cutoff === null ? profile.draws : (stats?.draws ?? 0),
        gamesPlayed: cutoff === null ? profile.gamesPlayed : (stats?.games ?? 0),
        ratingGain: cutoff === null ? 0 : (stats?.ratingGain ?? 0),
      };
    });

    rows.sort((a, b) => {
      if (query.sort === 'wins') {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.rating - a.rating;
      }
      if (cutoff !== null) {
        if (b.ratingGain !== a.ratingGain) return b.ratingGain - a.ratingGain;
      }
      if (b.rating !== a.rating) return b.rating - a.rating;
      return b.wins - a.wins;
    });

    return rows
      .slice(0, Math.max(0, query.limit))
      .map((row, index): LeaderboardRow => ({ rank: index + 1, ...row }));
  }

  async countProfiles(): Promise<number> {
    return this.data.profiles.length;
  }
}
