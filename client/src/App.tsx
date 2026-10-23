import { Suspense, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { getArena } from '@pfa/shared';

import { sfx } from './audio/sfx.js';
import { Scene } from './game/Scene.js';
import { useAimControls, useVolumeSync } from './hooks/useAimControls.js';
import { getStoredNickname, net, roomCodeFromUrl } from './net/socket.js';
import { store, useAppState } from './state/store.js';
import { Hud } from './ui/Hud.js';
import { Leaderboard } from './ui/Leaderboard.js';
import { Lobby } from './ui/Lobby.js';
import { MainMenu } from './ui/MainMenu.js';
import { Profile } from './ui/Profile.js';
import { ResultOverlay } from './ui/ResultOverlay.js';
import { Settings } from './ui/Settings.js';
import { Toasts } from './ui/Toasts.js';
import { Workshop } from './ui/Workshop.js';

const DPR_FOR_QUALITY: Record<'low' | 'medium' | 'high', [number, number]> = {
  low: [0.6, 1],
  medium: [1, 1.5],
  high: [1, 2],
};

/**
 * Connects on load and, when the page was opened from an invite link, signs in
 * and walks straight into that room. The scene renders behind every menu, so
 * the arena is on screen from the first frame rather than after a load step.
 */
function useBootstrap(): void {
  useEffect(() => {
    net.connect();

    const nickname = getStoredNickname();
    if (!nickname) return;

    void (async () => {
      try {
        const result = await net.authenticate(nickname);
        if (!result.ok) return;

        const invited = roomCodeFromUrl();
        const target = result.rejoinRoom ?? invited;
        if (!target) return;

        const joined = await net.joinRoom(target);
        if (joined.ok) {
          store.set({ room: joined.room, slot: joined.slot });
          // A practice match has no lobby to return to.
          store.navigate(joined.room.vsAi ? 'match' : 'lobby');
        } else if (invited) {
          store.toast(joined.error.message, 'warn');
        }
      } catch {
        // The menu already tells the player when the server is unreachable.
      }
    })();
  }, []);
}

export function App(): JSX.Element {
  const state = useAppState();
  const { screen, room, slot, settings, result, countdown } = state;

  useBootstrap();
  useVolumeSync();

  const inMatch = screen === 'match' && (room?.phase === 'playing' || room?.phase === 'countdown');

  useAimControls({
    slot,
    enabled: inMatch && room?.phase === 'playing' && !result,
    sensitivity: settings.aimSensitivity,
  });

  // Match sounds come from server events, so both players hear the same hits.
  useEffect(
    () =>
      net.onMatchEvent((event) => {
        switch (event.type) {
          case 'pen_hit':
            sfx.play('penHit', event.intensity);
            break;
          case 'desk_hit':
            sfx.play('deskHit', event.intensity);
            break;
          case 'fell':
            sfx.play('fall');
            break;
          case 'danger_enter':
            sfx.play('danger');
            break;
          default:
            break;
        }
      }),
    [],
  );

  useEffect(() => {
    if (countdown === null) return;
    sfx.unlock();
    sfx.play(countdown > 0 ? 'countdown' : 'go');
  }, [countdown]);

  const arena = useMemo(() => getArena(room?.arenaId ?? state.selectedArena), [
    room?.arenaId,
    state.selectedArena,
  ]);

  return (
    <>
      <div className="stage">
        <Canvas
          shadows
          dpr={DPR_FOR_QUALITY[settings.quality]}
          gl={{ antialias: settings.quality !== 'low', powerPreference: 'high-performance' }}
          camera={{ fov: 42, near: 0.5, far: 400, position: [-13.4, 12.8, 0] }}
          onCreated={({ gl, scene }) => {
            gl.toneMapping = THREE.ACESFilmicToneMapping;
            gl.toneMappingExposure = 1.05;
            scene.background = new THREE.Color(arena.fog.color);
          }}
        >
          <Suspense fallback={null}>
            <Scene room={room} slot={slot} settings={settings} />
          </Suspense>
        </Canvas>
      </div>

      {inMatch && !result ? <Hud /> : null}

      {screen === 'menu' ? <MainMenu /> : null}
      {screen === 'lobby' ? <Lobby /> : null}
      {screen === 'workshop' ? <Workshop /> : null}
      {screen === 'leaderboard' ? <Leaderboard /> : null}
      {screen === 'profile' ? <Profile /> : null}
      {screen === 'settings' ? <Settings /> : null}

      {result ? <ResultOverlay /> : null}

      <Toasts />
    </>
  );
}
