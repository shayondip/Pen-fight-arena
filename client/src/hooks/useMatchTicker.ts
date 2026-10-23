import { useEffect, useState } from 'react';

import type { InterpolatedPen } from '@pfa/shared';

import { net } from '../net/socket.js';

export interface MatchTick {
  timeLeftMs: number;
  pens: InterpolatedPen[];
  areaHalfX: number;
  live: boolean;
}

const EMPTY: MatchTick = { timeLeftMs: 0, pens: [], areaHalfX: 0, live: false };

/**
 * Samples the snapshot buffer for the DOM HUD at a deliberately low rate.
 *
 * The 3D scene reads the same buffer every frame, but a clock and a power bar
 * do not need 60 updates a second, and driving React that fast would cost far
 * more than it shows.
 */
export function useMatchTicker(enabled: boolean, hz = 12): MatchTick {
  const [tick, setTick] = useState<MatchTick>(EMPTY);

  useEffect(() => {
    if (!enabled) {
      setTick(EMPTY);
      return;
    }

    const interval = window.setInterval(() => {
      const sample = net.buffer.sample(Date.now());
      if (!sample) {
        setTick(EMPTY);
        return;
      }
      setTick({
        timeLeftMs: sample.timeLeftMs,
        pens: sample.pens,
        areaHalfX: sample.area.halfX,
        live: true,
      });
    }, Math.max(30, Math.round(1000 / hz)));

    return () => window.clearInterval(interval);
  }, [enabled, hz]);

  return tick;
}
