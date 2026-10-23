import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { AdaptiveDpr, Preload } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { SPAWN_A, SPAWN_B, getArena } from '@pfa/shared';
import type { PlayerSlot, RoomView } from '@pfa/shared';

import { net } from '../net/socket.js';
import type { GameSettings } from '../state/store.js';
import { AimIndicator } from './AimIndicator.js';
import { Boundary } from './Boundary.js';
import { CameraRig } from './CameraRig.js';
import { Desk } from './Desk.js';
import { ArenaEnvironment } from './Environment.js';
import { Ground } from './Ground.js';
import { Pen } from './Pen.js';

interface Props {
  room: RoomView | null;
  slot: PlayerSlot | null;
  settings: GameSettings;
}

/**
 * Applies the interpolated server state to the two pens, every frame.
 *
 * This is the only place match state reaches the renderer. It writes straight
 * into the Three.js transforms - no React state, no re-render - which is why a
 * 20 Hz server feed shows up as steady 60 fps motion.
 */
function PenSync({
  refA,
  refB,
  onEliminationChange,
}: {
  refA: RefObject<THREE.Group>;
  refB: RefObject<THREE.Group>;
  onEliminationChange: (next: { A: boolean; B: boolean }) => void;
}): null {
  const lastEliminated = useRef({ A: false, B: false });

  useFrame(() => {
    const sample = net.buffer.sample(Date.now());
    if (!sample) return;

    for (const pen of sample.pens) {
      const target = pen.slot === 'A' ? refA.current : refB.current;
      if (!target) continue;
      target.position.set(pen.position.x, pen.position.y, pen.position.z);
      target.quaternion.set(pen.rotation.x, pen.rotation.y, pen.rotation.z, pen.rotation.w);
    }

    const a = sample.pens.find((pen) => pen.slot === 'A')?.eliminated ?? false;
    const b = sample.pens.find((pen) => pen.slot === 'B')?.eliminated ?? false;
    if (a !== lastEliminated.current.A || b !== lastEliminated.current.B) {
      lastEliminated.current = { A: a, B: b };
      onEliminationChange({ A: a, B: b });
    }
  });

  return null;
}

export function Scene({ room, slot, settings }: Props): JSX.Element {
  const arena = getArena(room?.arenaId);
  const refA = useRef<THREE.Group>(null);
  const refB = useRef<THREE.Group>(null);
  const [eliminated, setEliminated] = useState({ A: false, B: false });

  const skinA = room?.players.find((player) => player.slot === 'A')?.profile.skinId ?? 'classic-blue';
  const skinB = room?.players.find((player) => player.slot === 'B')?.profile.skinId ?? 'crimson-red';

  useEffect(() => {
    setEliminated({ A: false, B: false });
  }, [room?.code, room?.phase === 'countdown']);

  return (
    <>
      <ArenaEnvironment arena={arena} quality={settings.quality} />
      <CameraRig slot={slot} />

      <Ground arena={arena} />
      <Desk arena={arena} />
      <Boundary />

      {/*
        The initial rotation matches SPAWN_ROTATION (a quarter turn about X),
        so the pens lie flat on the desk from the very first frame instead of
        standing on end until the first snapshot arrives. PenSync overwrites
        both transforms every frame once the match is live.
      */}
      <group
        ref={refA}
        position={[SPAWN_A.x, SPAWN_A.y, SPAWN_A.z]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <Pen slot="A" skinId={skinA} eliminated={eliminated.A} />
      </group>
      <group
        ref={refB}
        position={[SPAWN_B.x, SPAWN_B.y, SPAWN_B.z]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <Pen slot="B" skinId={skinB} eliminated={eliminated.B} />
      </group>

      <PenSync refA={refA} refB={refB} onEliminationChange={setEliminated} />

      {slot ? <AimIndicator slot={slot} /> : null}

      <AdaptiveDpr pixelated />
      <Preload all />
    </>
  );
}
