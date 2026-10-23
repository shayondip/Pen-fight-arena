import { MATCH_DURATION_MS, SHRINK_START_MS } from '@pfa/shared';
import type { PlayerSlot, RoomView } from '@pfa/shared';

import { useMatchTicker } from '../hooks/useMatchTicker.js';
import { useAppState } from '../state/store.js';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function Plate({ room, slot }: { room: RoomView | null; slot: PlayerSlot }): JSX.Element | null {
  const player = room?.players.find((candidate) => candidate.slot === slot);
  if (!player) return null;

  return (
    <div className={`scoreplate scoreplate--${slot.toLowerCase()}`}>
      <span className="scoreplate__name">{player.profile.nickname}</span>
      <span className="scoreplate__rating">{player.profile.rating}</span>
    </div>
  );
}

export function Hud(): JSX.Element {
  const { room, slot, countdown, settings, pingMs, connected } = useAppState();
  const tick = useMatchTicker(room?.phase === 'playing' || room?.phase === 'countdown');

  const you = tick.pens.find((pen) => pen.slot === slot);
  const opponent = tick.pens.find((pen) => pen.slot !== slot);

  const elapsed = MATCH_DURATION_MS - tick.timeLeftMs;
  const shrinking = elapsed > SHRINK_START_MS && tick.live;
  const urgent = tick.timeLeftMs < 15_000 && tick.live;

  const inDanger = you?.graceLeftMs != null;
  const opponentInDanger = opponent?.graceLeftMs != null;

  const hint = settings.showHints
    ? 'Drag back and release to flick. On a keyboard: Left and Right to aim, hold Space to charge.'
    : null;

  return (
    <div className="hud">
      <div className="hud__top">
        <Plate room={room} slot="A" />

        <div className={`clock${urgent ? ' clock--urgent' : ''}`}>
          {tick.live ? formatClock(tick.timeLeftMs) : '—'}
          <span className="clock__note">
            {shrinking
              ? 'Playing area is closing in'
              : room?.vsAi
                ? `Practice · ${room.vsAi}`
                : room?.mode === 'ranked'
                  ? 'Ranked'
                  : 'Casual'}
          </span>
        </div>

        <Plate room={room} slot="B" />
      </div>

      {countdown !== null ? (
        <div className="statusline">{countdown > 0 ? countdown : 'GO'}</div>
      ) : null}

      {inDanger ? (
        <div className="statusline statusline--warn">
          Outside the area — {Math.ceil((you?.graceLeftMs ?? 0) / 100) / 10}s to get back
        </div>
      ) : opponentInDanger ? (
        <div className="statusline statusline--warn" style={{ color: 'var(--gold)' }}>
          Their pen is out of the area
        </div>
      ) : null}

      <div className="hud__bottom">
        <div className="powerbar" aria-hidden="true">
          <div
            className="powerbar__fill"
            style={{ width: `${Math.round((you?.chargePower ?? 0) * 100)}%` }}
          />
        </div>
        {hint ? <p className="hint">{hint}</p> : null}
      </div>

      <div className="netpill">
        {connected ? `${pingMs} ms` : 'offline'}
      </div>
    </div>
  );
}
