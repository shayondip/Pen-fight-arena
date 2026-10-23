import { useEffect, useState } from 'react';

import { getArena } from '@pfa/shared';
import type { MatchRecord } from '@pfa/shared';

import { fetchMatchHistory } from '../net/api.js';
import { store, useAppState } from '../state/store.js';

function outcomeFor(match: MatchRecord, profileId: string): 'Won' | 'Lost' | 'Drew' {
  if (match.outcome === 'draw') return 'Drew';
  const youAreA = match.playerAId === profileId;
  const youWon = (match.outcome === 'A' && youAreA) || (match.outcome === 'B' && !youAreA);
  return youWon ? 'Won' : 'Lost';
}

export function Profile(): JSX.Element {
  const { profile } = useAppState();
  const [matches, setMatches] = useState<MatchRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    let cancelled = false;

    void (async () => {
      setLoading(true);
      try {
        const data = await fetchMatchHistory(profile.id, 25);
        if (!cancelled) setMatches(data.matches);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : 'Could not load match history.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [profile?.id]);

  if (!profile) {
    return (
      <div className="overlay">
        <div className="sheet">
          <h2>Profile</h2>
          <p>Set a nickname on the menu to create your profile.</p>
          <button type="button" className="button" onClick={() => store.navigate('menu')}>
            Back to menu
          </button>
        </div>
      </div>
    );
  }

  const winRate =
    profile.gamesPlayed > 0 ? Math.round((profile.wins / profile.gamesPlayed) * 100) : 0;

  return (
    <div className="overlay">
      <div className="sheet sheet--wide sheet--tilt">
        <div className="masthead">
          <div>
            <h2>{profile.nickname}</h2>
            <p className="masthead__sub">Playing since {new Date(profile.createdAt).toLocaleDateString()}</p>
          </div>
          <span className="wallet">{profile.coins} Pen Coins</span>
        </div>

        <div className="result__grid">
          <div>
            <div className="stat__value">{profile.rating}</div>
            <div className="stat__label">Rating</div>
          </div>
          <div>
            <div className="stat__value">{profile.gamesPlayed}</div>
            <div className="stat__label">Matches played</div>
          </div>
          <div>
            <div className="stat__value">
              {profile.wins}–{profile.losses}–{profile.draws}
            </div>
            <div className="stat__label">Win / loss / draw</div>
          </div>
          <div>
            <div className="stat__value">{winRate}%</div>
            <div className="stat__label">Win rate</div>
          </div>
        </div>

        <h3>Recent matches</h3>
        {loading ? <p>Loading…</p> : null}
        {error ? <p style={{ color: '#a3302b' }}>{error}</p> : null}

        {!loading && matches.length === 0 ? (
          <p className="empty-state">
            No matches yet. Create a room from the menu and invite someone.
          </p>
        ) : null}

        {matches.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Result</th>
                <th>Opponent</th>
                <th>Mode</th>
                <th>Arena</th>
                <th className="numeric">Rating</th>
                <th className="numeric">Played</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((match) => {
                const youAreA = match.playerAId === profile.id;
                const opponent = youAreA ? match.playerBNickname : match.playerANickname;
                const delta = youAreA ? match.ratingADelta : match.ratingBDelta;
                const result = outcomeFor(match, profile.id);

                return (
                  <tr key={match.id}>
                    <td>{result}</td>
                    <td>{opponent}</td>
                    <td>{match.mode === 'ranked' ? 'Ranked' : 'Casual'}</td>
                    <td>{getArena(match.arenaId).name}</td>
                    <td className={`numeric ${delta >= 0 ? 'delta--up' : 'delta--down'}`}>
                      {match.mode === 'ranked' ? `${delta >= 0 ? '+' : ''}${delta}` : '—'}
                    </td>
                    <td className="numeric">{new Date(match.playedAt).toLocaleDateString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : null}

        <div className="button-row" style={{ marginTop: 20 }}>
          <button type="button" className="button button--ghost" onClick={() => store.navigate('menu')}>
            Back to menu
          </button>
        </div>
      </div>
    </div>
  );
}
