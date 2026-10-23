import { useCallback, useEffect, useState } from 'react';

import type { LeaderboardPeriod, LeaderboardResponse, LeaderboardSort } from '@pfa/shared';

import { fetchLeaderboard } from '../net/api.js';
import { store, useAppState } from '../state/store.js';
import { StorageNote } from './StorageNote.js';

const PERIODS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'all', label: 'All time' },
  { id: 'monthly', label: 'This month' },
  { id: 'weekly', label: 'This week' },
];

const SORTS: { id: LeaderboardSort; label: string }[] = [
  { id: 'rating', label: 'By rating' },
  { id: 'wins', label: 'By wins' },
];

export function Leaderboard(): JSX.Element {
  const { profile, storage } = useAppState();
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const [sort, setSort] = useState<LeaderboardSort>('rating');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchLeaderboard(period, sort, 50));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not load the leaderboard.');
    } finally {
      setLoading(false);
    }
  }, [period, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const windowed = period !== 'all';

  return (
    <div className="overlay">
      <div className="sheet sheet--wide sheet--tilt">
        <div className="masthead">
          <div>
            <h2>Leaderboard</h2>
            <p className="masthead__sub">
              Built from stored match records. Nothing here is seeded or simulated.
            </p>
          </div>
        </div>

        <div className="button-row" style={{ marginBottom: 14 }}>
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={period === option.id ? 'button button--small' : 'button button--ghost button--small'}
              onClick={() => setPeriod(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="button-row" style={{ marginBottom: 16 }}>
          {SORTS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={sort === option.id ? 'button button--small' : 'button button--ghost button--small'}
              onClick={() => setSort(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        {loading ? <p>Loading…</p> : null}
        {error ? <p style={{ color: '#a3302b' }}>{error}</p> : null}

        {!loading && !error && data && data.rows.length === 0 ? (
          <p className="empty-state">
            No matches recorded yet. Play a ranked match and you will be the first name on this
            board.
          </p>
        ) : null}

        {!loading && data && data.rows.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th className="numeric">Rating</th>
                {windowed ? <th className="numeric">Gain</th> : null}
                <th className="numeric">W</th>
                <th className="numeric">L</th>
                <th className="numeric">D</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.profileId} className={row.profileId === profile?.id ? 'table__me' : ''}>
                  <td className="table__rank">{row.rank}</td>
                  <td>{row.nickname}</td>
                  <td className="numeric">{row.rating}</td>
                  {windowed ? (
                    <td className={`numeric ${row.ratingGain >= 0 ? 'delta--up' : 'delta--down'}`}>
                      {row.ratingGain >= 0 ? '+' : ''}
                      {row.ratingGain}
                    </td>
                  ) : null}
                  <td className="numeric">{row.wins}</td>
                  <td className="numeric">{row.losses}</td>
                  <td className="numeric">{row.draws}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        <div className="button-row" style={{ marginTop: 20 }}>
          <button type="button" className="button button--ghost" onClick={() => store.navigate('menu')}>
            Back to menu
          </button>
          <button type="button" className="button button--ghost" onClick={() => void load()}>
            Refresh
          </button>
        </div>

        <StorageNote storage={storage} />
      </div>
    </div>
  );
}
