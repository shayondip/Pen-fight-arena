import { TICK_MS } from '@pfa/shared';

import { logger } from '../logger.js';
import type { Match } from './match.js';

/**
 * Fixed-timestep driver for every live match on the server.
 *
 * One timer steps all matches so the simulation rate does not drift with the
 * number of rooms. The accumulator keeps the step size constant even when the
 * event loop is briefly busy, and the catch-up cap stops a long stall from
 * trying to simulate thousands of ticks at once.
 */
export class GameLoop {
  private readonly matches = new Set<Match>();
  private timer: NodeJS.Timeout | null = null;
  private lastTime = 0;
  private accumulator = 0;

  /** Never simulate more than this many ticks in one wake-up. */
  private readonly maxCatchUpTicks = 10;

  add(match: Match): void {
    this.matches.add(match);
    this.start();
  }

  remove(match: Match): void {
    this.matches.delete(match);
    if (this.matches.size === 0) this.stop();
  }

  get size(): number {
    return this.matches.size;
  }

  start(): void {
    if (this.timer) return;
    this.lastTime = Date.now();
    this.accumulator = 0;
    this.timer = setInterval(() => this.tick(), Math.max(4, Math.floor(TICK_MS / 2)));
    logger.debug('Game loop started.');
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
    logger.debug('Game loop idle.');
  }

  /** Steps the loop once. Exposed so tests can drive it deterministically. */
  tick(now: number = Date.now()): void {
    const delta = Math.max(0, now - this.lastTime);
    this.lastTime = now;
    this.accumulator += delta;

    let ticks = 0;
    while (this.accumulator >= TICK_MS && ticks < this.maxCatchUpTicks) {
      this.accumulator -= TICK_MS;
      ticks += 1;
      for (const match of this.matches) {
        try {
          match.step(now);
        } catch (error) {
          logger.error('Match step failed; removing match from the loop.', error);
          this.matches.delete(match);
        }
      }
    }

    if (ticks >= this.maxCatchUpTicks) {
      // The loop fell badly behind: drop the backlog rather than spiral.
      this.accumulator = 0;
    }
  }
}
