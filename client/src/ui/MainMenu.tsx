import { useEffect, useState } from 'react';

import {
  AI_DIFFICULTIES,
  AI_PROFILES,
  ARENAS,
  MAX_NICKNAME_LENGTH,
  getArena,
} from '@pfa/shared';
import type { AiDifficulty, GameMode } from '@pfa/shared';

import { sfx } from '../audio/sfx.js';
import { getStoredNickname, net, roomCodeFromUrl } from '../net/socket.js';
import { store, useAppState } from '../state/store.js';
import { StorageNote } from './StorageNote.js';

export function MainMenu(): JSX.Element {
  const {
    profile,
    storage,
    selectedArena,
    selectedMode,
    selectedDifficulty,
    connected,
    busy,
  } = useAppState();

  const [nickname, setNickname] = useState(() => profile?.nickname ?? getStoredNickname());
  const [code, setCode] = useState(() => roomCodeFromUrl() ?? '');

  useEffect(() => {
    if (profile?.nickname) setNickname(profile.nickname);
  }, [profile?.nickname]);

  const canAct = connected && !busy;

  const ensureProfile = async (): Promise<boolean> => {
    sfx.unlock();
    const trimmed = nickname.trim();
    if (trimmed.length < 2) {
      store.toast('Enter a nickname of at least 2 characters.', 'warn');
      return false;
    }
    if (profile && profile.nickname === trimmed) return true;

    store.set({ busy: true });
    try {
      const result = await net.authenticate(trimmed);
      if (!result.ok) {
        store.toast(result.error.message, 'error');
        return false;
      }
      return true;
    } catch {
      store.toast('Could not reach the server. Is it running on port 4000?', 'error');
      return false;
    } finally {
      store.set({ busy: false });
    }
  };

  const handlePlayVsAi = async (): Promise<void> => {
    if (!(await ensureProfile())) return;

    store.set({ busy: true });
    const result = await net.startSoloMatch(selectedDifficulty, selectedArena);
    store.set({ busy: false });

    if (!result.ok) {
      store.toast(result.error.message, 'error');
      return;
    }
    store.set({ room: result.room, slot: result.slot, result: null });
    store.navigate('match');
  };

  const handleCreate = async (): Promise<void> => {
    if (!(await ensureProfile())) return;

    store.set({ busy: true });
    const result = await net.createRoom(selectedMode, selectedArena);
    store.set({ busy: false });

    if (!result.ok) {
      store.toast(result.error.message, 'error');
      return;
    }
    store.set({ room: result.room, slot: result.slot });
    store.navigate('lobby');
  };

  const handleJoin = async (): Promise<void> => {
    const trimmedCode = code.trim().toUpperCase();
    if (trimmedCode.length !== 5) {
      store.toast('Room codes are 5 characters.', 'warn');
      return;
    }
    if (!(await ensureProfile())) return;

    store.set({ busy: true });
    const result = await net.joinRoom(trimmedCode);
    store.set({ busy: false });

    if (!result.ok) {
      store.toast(result.error.message, 'error');
      return;
    }
    store.set({ room: result.room, slot: result.slot });
    store.navigate('lobby');
  };

  const arena = getArena(selectedArena);

  return (
    <div className="overlay">
      <div className="sheet sheet--wide sheet--tilt">
        <div className="masthead">
          <div>
            <h1>Pen Fight Arena</h1>
            <p className="masthead__sub">
              Two pens, one desk. Knock theirs off the marked area and keep yours on it.
            </p>
          </div>
        </div>

        <label className="field">
          <span className="field__label">Your name</span>
          <input
            className="field__input"
            value={nickname}
            maxLength={MAX_NICKNAME_LENGTH}
            placeholder="Shayondip"
            onChange={(event) => setNickname(event.target.value)}
            onBlur={() => void ensureProfile()}
          />
        </label>

        {/* ------------------------------------------------- single player */}
        <section className="section">
          <h2>Play vs AI</h2>
          <p>
            One player, starts straight away. No room code and nobody else needed.
          </p>

          <div className="choice-grid">
            {AI_DIFFICULTIES.map((difficulty: AiDifficulty) => {
              const preset = AI_PROFILES[difficulty];
              return (
                <button
                  key={difficulty}
                  type="button"
                  className="choice"
                  aria-pressed={selectedDifficulty === difficulty}
                  onClick={() => store.set({ selectedDifficulty: difficulty })}
                >
                  <span className="choice__name">{preset.label}</span>
                  <span className="choice__note">{preset.blurb}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            className="button button--wide"
            disabled={!canAct}
            onClick={() => void handlePlayVsAi()}
          >
            Start {AI_PROFILES[selectedDifficulty].label} match
          </button>

          <p className="section__note">
            The computer plays a stock pen, so your Workshop upgrades count against it. Practice
            earns half coins and leaves your rating and record alone.
          </p>
        </section>

        {/* ------------------------------------------------ online multiplayer */}
        <section className="section">
          <h2>Online multiplayer</h2>
          <p>Create a room and send the code, or join someone else's.</p>

          <div className="choice-grid">
            {(
              [
                {
                  mode: 'casual' as GameMode,
                  name: 'Casual',
                  note: 'Every upgrade you own is active. Rating is untouched.',
                },
                {
                  mode: 'ranked' as GameMode,
                  name: 'Ranked',
                  note: 'Upgrades are normalised for both players. Elo moves.',
                },
              ]
            ).map((option) => (
              <button
                key={option.mode}
                type="button"
                className="choice"
                aria-pressed={selectedMode === option.mode}
                onClick={() => store.set({ selectedMode: option.mode })}
              >
                <span className="choice__name">{option.name}</span>
                <span className="choice__note">{option.note}</span>
              </button>
            ))}
          </div>

          <div className="button-row">
            <button
              type="button"
              className="button"
              disabled={!canAct}
              onClick={() => void handleCreate()}
            >
              Create room
            </button>
          </div>

          <label className="field" style={{ marginTop: 16 }}>
            <span className="field__label">Or join with a room code</span>
            <input
              className="field__input field__input--code"
              value={code}
              maxLength={5}
              placeholder="ABCDE"
              inputMode="text"
              autoCapitalize="characters"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void handleJoin();
              }}
            />
          </label>
          <button
            type="button"
            className="button button--ghost button--wide"
            disabled={!canAct}
            onClick={() => void handleJoin()}
          >
            Join room
          </button>
        </section>

        {/* ----------------------------------------------------------- arena */}
        <section className="section">
          <h2>Arena</h2>
          <p>{arena.description}</p>
          <div className="arena-strip">
            {ARENAS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className="arena-swatch"
                aria-pressed={selectedArena === preset.id}
                onClick={() => store.set({ selectedArena: preset.id })}
                title={preset.description}
              >
                <span
                  className="arena-swatch__sky"
                  style={{
                    background: `linear-gradient(160deg, ${preset.fog.color}, ${preset.grass.base})`,
                  }}
                />
                <span className="arena-swatch__name">{preset.name}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="button-row" style={{ marginTop: 22 }}>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => store.navigate('workshop')}
            disabled={!profile}
          >
            Pen Workshop
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => store.navigate('leaderboard')}
          >
            Leaderboard
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => store.navigate('profile')}
            disabled={!profile}
          >
            Profile
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            onClick={() => store.navigate('settings')}
          >
            Settings
          </button>
        </div>

        {!connected ? (
          <p style={{ marginTop: 16, color: '#a3302b' }}>
            Not connected to the game server. Start it with <code>npm run dev</code> and this page
            will reconnect on its own.
          </p>
        ) : null}

        <StorageNote storage={storage} />
      </div>
    </div>
  );
}
