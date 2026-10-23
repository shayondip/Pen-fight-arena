import { Router } from 'express';
import type { Request, Response } from 'express';

import { ARENAS, ATTRIBUTE_KEYS, PEN_SKINS, sanitizeNickname } from '@pfa/shared';
import type { AttributeKey, LeaderboardPeriod, LeaderboardSort } from '@pfa/shared';

import { logger } from '../logger.js';
import type { Store } from '../store/types.js';

function parsePeriod(raw: unknown): LeaderboardPeriod {
  return raw === 'weekly' || raw === 'monthly' ? raw : 'all';
}

function parseSort(raw: unknown): LeaderboardSort {
  return raw === 'wins' ? 'wins' : 'rating';
}

function parseLimit(raw: unknown, fallback: number, max: number): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function isAttributeKey(raw: unknown): raw is AttributeKey {
  return typeof raw === 'string' && (ATTRIBUTE_KEYS as string[]).includes(raw);
}

/**
 * REST surface for everything that is not part of the live match loop.
 *
 * Mutating routes require the profile's secret in the `x-pfa-secret` header -
 * the same token the socket handshake issues - so a profile id alone is not
 * enough to spend someone else's coins.
 */
export function createApiRouter(store: Store): Router {
  const router = Router();

  const requireOwner = async (req: Request, res: Response, profileId: string): Promise<boolean> => {
    const secret = req.header('x-pfa-secret');
    if (!secret) {
      res.status(401).json({ error: 'missing_secret', message: 'Profile secret required.' });
      return false;
    }
    const valid = await store.verifySecret(profileId, secret);
    if (!valid) {
      res.status(403).json({ error: 'bad_secret', message: 'That profile is not yours.' });
      return false;
    }
    return true;
  };

  router.get('/health', (_req, res) => {
    res.json({ ok: true, storage: store.status(), time: new Date().toISOString() });
  });

  router.get('/storage', (_req, res) => {
    res.json(store.status());
  });

  router.get('/content', (_req, res) => {
    res.json({ arenas: ARENAS, skins: PEN_SKINS });
  });

  router.get('/leaderboard', async (req, res) => {
    try {
      const period = parsePeriod(req.query.period);
      const sort = parseSort(req.query.sort);
      const limit = parseLimit(req.query.limit, 25, 100);

      const rows = await store.leaderboard({ period, sort, limit });
      res.json({
        period,
        sort,
        storage: store.status().kind,
        rows,
        generatedAt: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('leaderboard failed', error);
      res.status(500).json({ error: 'server_error' });
    }
  });

  router.get('/profiles/:id', async (req, res) => {
    const profile = await store.getProfile(String(req.params.id));
    if (!profile) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(profile);
  });

  router.get('/profiles/:id/matches', async (req, res) => {
    const limit = parseLimit(req.query.limit, 20, 100);
    const profile = await store.getProfile(String(req.params.id));
    if (!profile) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    const matches = await store.getMatchHistory(profile.id, limit);
    res.json({ profile, matches });
  });

  router.post('/profiles/:id/nickname', async (req, res) => {
    const profileId = String(req.params.id);
    if (!(await requireOwner(req, res, profileId))) return;

    const nickname = sanitizeNickname((req.body as { nickname?: unknown } | undefined)?.nickname);
    if (!nickname) {
      res.status(400).json({ error: 'bad_nickname', message: 'Use 2 to 16 characters.' });
      return;
    }

    const updated = await store.setNickname(profileId, nickname);
    if (!updated) {
      res.status(404).json({ error: 'not_found' });
      return;
    }
    res.json(updated);
  });

  router.post('/profiles/:id/upgrade', async (req, res) => {
    const profileId = String(req.params.id);
    if (!(await requireOwner(req, res, profileId))) return;

    const attribute = (req.body as { attribute?: unknown } | undefined)?.attribute;
    if (!isAttributeKey(attribute)) {
      res.status(400).json({ error: 'bad_attribute' });
      return;
    }

    const updated = await store.purchaseUpgrade(profileId, attribute);
    if (!updated) {
      res
        .status(409)
        .json({ error: 'cannot_upgrade', message: 'Not enough coins, or already at max level.' });
      return;
    }
    res.json(updated);
  });

  router.post('/profiles/:id/skin', async (req, res) => {
    const profileId = String(req.params.id);
    if (!(await requireOwner(req, res, profileId))) return;

    const skinId = (req.body as { skinId?: unknown } | undefined)?.skinId;
    if (typeof skinId !== 'string') {
      res.status(400).json({ error: 'bad_skin' });
      return;
    }

    const updated = await store.purchaseOrEquipSkin(profileId, skinId);
    if (!updated) {
      res
        .status(409)
        .json({ error: 'cannot_equip', message: 'Unknown skin, or not enough coins.' });
      return;
    }
    res.json(updated);
  });

  return router;
}
