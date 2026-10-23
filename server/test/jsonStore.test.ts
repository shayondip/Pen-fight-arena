import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { STARTING_COINS, STARTING_RATING, upgradeCost } from '@pfa/shared';

import { JsonStore } from '../src/store/jsonStore.js';

let dir: string;
let store: JsonStore;

async function makeProfile(name: string, suffix: string) {
  const result = await store.authenticate({
    clientId: `client-${suffix.padEnd(10, 'x')}`,
    nickname: name,
    secret: `secret-${suffix}-abcdef`,
  });
  if (!result) throw new Error('authenticate returned null');
  return result.profile;
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pfa-store-'));
  store = new JsonStore(dir);
  await store.init();
});

afterEach(async () => {
  await store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('profiles', () => {
  it('creates a profile with the documented starting state', async () => {
    const profile = await makeProfile('Shayondip', 'a');
    expect(profile.rating).toBe(STARTING_RATING);
    expect(profile.coins).toBe(STARTING_COINS);
    expect(profile.gamesPlayed).toBe(0);
    expect(profile.ownedSkins.length).toBeGreaterThan(0);
  });

  it('returns the same profile for the same client id and secret', async () => {
    const first = await makeProfile('Shayondip', 'a');
    const again = await store.authenticate({
      clientId: 'client-axxxxxxxxx',
      nickname: 'Shayondip',
      secret: 'secret-a-abcdef',
    });
    expect(again?.profile.id).toBe(first.id);
    expect(again?.issuedSecret).toBeNull();
  });

  it('refuses a wrong secret for a known client id', async () => {
    await makeProfile('Shayondip', 'a');
    const impostor = await store.authenticate({
      clientId: 'client-axxxxxxxxx',
      nickname: 'Impostor',
      secret: 'secret-wrong-00000',
    });
    expect(impostor).toBeNull();
  });

  it('never hands the stored secret back out', async () => {
    const profile = await makeProfile('Shayondip', 'a');
    expect(Object.keys(profile)).not.toContain('secretHash');
  });
});

describe('economy', () => {
  it('spends coins on an upgrade', async () => {
    const profile = await makeProfile('Shayondip', 'a');
    const cost = upgradeCost('impact', 0) as number;

    const upgraded = await store.purchaseUpgrade(profile.id, 'impact');
    expect(upgraded?.attributes.impact).toBe(1);
    expect(upgraded?.coins).toBe(STARTING_COINS - cost);
  });

  it('refuses an upgrade the player cannot afford', async () => {
    const profile = await makeProfile('Shayondip', 'a');
    await store.purchaseUpgrade(profile.id, 'impact');
    // Level 2 costs 110 and only 90 coins remain.
    expect(await store.purchaseUpgrade(profile.id, 'impact')).toBeNull();
  });

  it('stops at the maximum level', async () => {
    const profile = await makeProfile('Rich', 'b');
    // Top the wallet up directly through recordMatch rewards.
    for (let i = 0; i < 40; i += 1) {
      await store.recordMatch({
        roomCode: 'AAAAA',
        mode: 'casual',
        arenaId: 'classroom-morning',
        playerAId: profile.id,
        playerBId: profile.id,
        playerANickname: 'Rich',
        playerBNickname: 'Rich',
        outcome: 'draw',
        reason: 'time',
        ratingADelta: 0,
        ratingBDelta: 0,
        ratingAAfter: 1000,
        ratingBAfter: 1000,
        coinsA: 500,
        coinsB: 0,
        durationMs: 1000,
      });
    }

    for (let level = 0; level < 5; level += 1) {
      expect(await store.purchaseUpgrade(profile.id, 'control')).not.toBeNull();
    }
    expect(await store.purchaseUpgrade(profile.id, 'control')).toBeNull();
  });

  it('awards coins without touching rating, record or history', async () => {
    const profile = await makeProfile('Practicer', 'a');

    const updated = await store.awardCoins(profile.id, 45);
    expect(updated?.coins).toBe(STARTING_COINS + 45);

    // A practice payout must leave every competitive number alone.
    expect(updated?.rating).toBe(profile.rating);
    expect(updated?.wins).toBe(0);
    expect(updated?.losses).toBe(0);
    expect(updated?.gamesPlayed).toBe(0);
    expect(await store.getMatchHistory(profile.id, 10)).toEqual([]);
    expect(await store.leaderboard({ period: 'all', sort: 'rating', limit: 10 })).toEqual([]);
  });

  it('never drives a coin balance negative', async () => {
    const profile = await makeProfile('Broke', 'a');
    const updated = await store.awardCoins(profile.id, -99_999);
    expect(updated?.coins).toBe(0);
  });

  it('returns null when awarding coins to someone who does not exist', async () => {
    expect(await store.awardCoins('no-such-profile', 50)).toBeNull();
  });

  it('equips an owned skin for free and refuses an unaffordable one', async () => {
    const profile = await makeProfile('Shayondip', 'a');
    const equipped = await store.purchaseOrEquipSkin(profile.id, 'crimson-red');
    expect(equipped?.skinId).toBe('crimson-red');
    expect(equipped?.coins).toBe(STARTING_COINS);

    expect(await store.purchaseOrEquipSkin(profile.id, 'lab-white')).toBeNull();
    expect(await store.purchaseOrEquipSkin(profile.id, 'no-such-skin')).toBeNull();
  });
});

describe('matches and leaderboards', () => {
  async function playMatch(
    a: string,
    b: string,
    outcome: 'A' | 'B' | 'draw',
    deltaA: number,
    ratingAAfter: number,
  ) {
    return store.recordMatch({
      roomCode: 'AB3XY',
      mode: 'ranked',
      arenaId: 'classroom-morning',
      playerAId: a,
      playerBId: b,
      playerANickname: 'A',
      playerBNickname: 'B',
      outcome,
      reason: 'fell',
      ratingADelta: deltaA,
      ratingBDelta: -deltaA,
      ratingAAfter,
      ratingBAfter: 2000 - ratingAAfter,
      coinsA: 60,
      coinsB: 25,
      durationMs: 30_000,
    });
  }

  it('updates both players after a match', async () => {
    const one = await makeProfile('One', 'a');
    const two = await makeProfile('Two', 'b');
    await playMatch(one.id, two.id, 'A', 16, 1016);

    const updatedOne = await store.getProfile(one.id);
    const updatedTwo = await store.getProfile(two.id);

    expect(updatedOne?.wins).toBe(1);
    expect(updatedOne?.rating).toBe(1016);
    expect(updatedOne?.gamesPlayed).toBe(1);
    expect(updatedTwo?.losses).toBe(1);
    expect(updatedTwo?.rating).toBe(984);
  });

  it('starts with an empty leaderboard and never invents players', async () => {
    expect(await store.leaderboard({ period: 'all', sort: 'rating', limit: 10 })).toEqual([]);

    await makeProfile('Unplayed', 'a');
    // A profile with no matches does not appear on the board.
    expect(await store.leaderboard({ period: 'all', sort: 'rating', limit: 10 })).toEqual([]);
  });

  it('ranks by rating and by wins', async () => {
    const one = await makeProfile('One', 'a');
    const two = await makeProfile('Two', 'b');
    await playMatch(one.id, two.id, 'A', 40, 1040);

    const byRating = await store.leaderboard({ period: 'all', sort: 'rating', limit: 10 });
    expect(byRating[0]?.nickname).toBe('One');
    expect(byRating[0]?.rank).toBe(1);
    expect(byRating[1]?.rank).toBe(2);

    const byWins = await store.leaderboard({ period: 'all', sort: 'wins', limit: 10 });
    expect(byWins[0]?.wins).toBe(1);
  });

  it('reports rating gained inside the weekly window', async () => {
    const one = await makeProfile('One', 'a');
    const two = await makeProfile('Two', 'b');
    await playMatch(one.id, two.id, 'A', 16, 1016);
    await playMatch(one.id, two.id, 'A', 15, 1031);

    const weekly = await store.leaderboard({ period: 'weekly', sort: 'rating', limit: 10 });
    expect(weekly[0]?.nickname).toBe('One');
    expect(weekly[0]?.ratingGain).toBe(31);
    expect(weekly[0]?.gamesPlayed).toBe(2);
  });

  it('respects the limit', async () => {
    const one = await makeProfile('One', 'a');
    const two = await makeProfile('Two', 'b');
    await playMatch(one.id, two.id, 'A', 16, 1016);
    expect((await store.leaderboard({ period: 'all', sort: 'rating', limit: 1 })).length).toBe(1);
  });

  it('returns match history newest first', async () => {
    const one = await makeProfile('One', 'a');
    const two = await makeProfile('Two', 'b');
    await playMatch(one.id, two.id, 'A', 16, 1016);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await playMatch(one.id, two.id, 'B', -16, 1000);

    const history = await store.getMatchHistory(one.id, 10);
    expect(history.length).toBe(2);
    expect(Date.parse(history[0]!.playedAt)).toBeGreaterThanOrEqual(Date.parse(history[1]!.playedAt));
  });
});

describe('persistence', () => {
  it('survives a restart', async () => {
    const profile = await makeProfile('Shayondip', 'a');
    await store.purchaseUpgrade(profile.id, 'impact');
    await store.close();

    const reopened = new JsonStore(dir);
    await reopened.init();
    const reloaded = await reopened.getProfile(profile.id);

    expect(reloaded?.attributes.impact).toBe(1);
    expect(reloaded?.nickname).toBe('Shayondip');
    await reopened.close();
  });
});
