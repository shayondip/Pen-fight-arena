import { useEffect, useRef, useState } from 'react';

import { AI_DIFFICULTIES, AI_PROFILES } from '@pfa/shared';
import type { AiDifficulty, PlayerSlot } from '@pfa/shared';

import { sfx } from '../audio/sfx.js';
import { net } from '../net/socket.js';
import { store, useAppState } from '../state/store.js';

const REASON_TEXT: Record<string, string> = {
  fell: 'knocked off the desk',
  out_of_bounds: 'left the playing area',
  forfeit: 'left the match',
  disconnect: 'lost connection',
  time: 'time ran out',
};

export function ResultOverlay(): JSX.Element | null {
  const { result, slot, room, selectedArena, selectedDifficulty, busy } = useAppState();
  const [voted, setVoted] = useState(false);
  const playedFor = useRef<string | null>(null);

  const vsAi = room?.vsAi ?? null;

  /** Starts a brand new practice match, optionally at a different difficulty. */
  const playAgainVsAi = async (difficulty: AiDifficulty): Promise<void> => {
    store.set({ busy: true, selectedDifficulty: difficulty });
    const started = await net.startSoloMatch(difficulty, room?.arenaId ?? selectedArena);
    store.set({ busy: false });

    if (!started.ok) {
      store.toast(started.error.message, 'error');
      return;
    }
    store.set({ room: started.room, slot: started.slot, result: null, countdown: null });
    store.navigate('match');
  };

  useEffect(() => {
    if (!result || !slot) return;
    const key = `${room?.code ?? ''}:${result.durationMs}`;
    if (playedFor.current === key) return;
    playedFor.current = key;

    if (result.outcome === 'draw') sfx.play('draw');
    else if (result.outcome === slot) sfx.play('win');
    else sfx.play('lose');
  }, [result, slot, room?.code]);

  useEffect(() => {
    setVoted(false);
  }, [result]);

  if (!result || !slot) return null;

  const mine = result.perPlayer[slot];
  const theirSlot: PlayerSlot = slot === 'A' ? 'B' : 'A';
  const theirs = result.perPlayer[theirSlot];

  const won = result.outcome === slot;
  const drew = result.outcome === 'draw';

  const headline = drew ? 'Draw' : won ? 'You win' : 'You lose';
  const headlineClass = drew ? '' : won ? ' result__headline--win' : ' result__headline--loss';

  const subtitle = drew
    ? result.reason === 'time'
      ? 'The clock ran out with both pens still on the desk.'
      : 'Both pens went out together.'
    : `${won ? theirs.nickname : mine.nickname}'s pen ${REASON_TEXT[result.reason] ?? 'went out'}.`;

  const opponentPresent = (room?.players.length ?? 0) === 2;
  const theirVote = room?.players.find((player) => player.slot === theirSlot)?.rematchVote ?? false;

  return (
    <div className="overlay">
      <div className="sheet result">
        <h2 className={`result__headline${headlineClass}`}>{headline}</h2>
        <p>{subtitle}</p>

        <div className="result__grid">
          <div>
            <div className="stat__value">+{mine.coinsEarned}</div>
            <div className="stat__label">Pen Coins earned</div>
          </div>
          <div>
            <div className="stat__value">{mine.hits}</div>
            <div className="stat__label">Hits landed</div>
          </div>
          <div>
            <div className="stat__value">
              {result.mode === 'ranked' ? (
                <span className={mine.ratingDelta >= 0 ? 'delta--up' : 'delta--down'}>
                  {mine.ratingDelta >= 0 ? '+' : ''}
                  {mine.ratingDelta}
                </span>
              ) : (
                '—'
              )}
            </div>
            <div className="stat__label">
              {result.mode === 'ranked' ? `Rating, now ${mine.ratingAfter}` : 'Casual: rating unchanged'}
            </div>
          </div>
          <div>
            <div className="stat__value">{Math.round(result.durationMs / 1000)}s</div>
            <div className="stat__label">Match length</div>
          </div>
        </div>

        {vsAi ? (
          <>
            <div className="button-row button-row--split">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => void playAgainVsAi(vsAi)}
              >
                Play again
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  net.leaveRoom();
                  store.navigate('menu');
                }}
              >
                Back to menu
              </button>
            </div>

            <div className="difficulty-switch">
              <span className="difficulty-switch__label">Try a different opponent</span>
              <div className="button-row">
                {AI_DIFFICULTIES.map((difficulty) => (
                  <button
                    key={difficulty}
                    type="button"
                    className={
                      difficulty === vsAi
                        ? 'button button--small'
                        : 'button button--ghost button--small'
                    }
                    disabled={busy}
                    onClick={() => void playAgainVsAi(difficulty)}
                  >
                    {AI_PROFILES[difficulty].label}
                  </button>
                ))}
              </div>
            </div>

            <p className="storage-note">
              Practice matches pay half coins and leave your rating and win record untouched.
            </p>
          </>
        ) : (
          <>
            <div className="button-row button-row--split">
              <button
                type="button"
                className="button"
                disabled={voted || !opponentPresent}
                onClick={() => {
                  setVoted(true);
                  net.voteRematch();
                }}
              >
                {voted
                  ? 'Waiting for them…'
                  : theirVote
                    ? 'They want a rematch — accept'
                    : 'Play again'}
              </button>
              <button
                type="button"
                className="button button--ghost"
                onClick={() => {
                  net.leaveRoom();
                  store.navigate('menu');
                }}
              >
                Back to menu
              </button>
            </div>

            {!opponentPresent ? (
              <p className="storage-note">
                Your opponent has left. Head back to the menu and start a new room.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
