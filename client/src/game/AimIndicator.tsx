import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { DESK_TOP_Y } from '@pfa/shared';
import type { PlayerSlot } from '@pfa/shared';

import { net } from '../net/socket.js';
import { aimState } from './aimState.js';

interface Props {
  slot: PlayerSlot;
}

/**
 * The aiming arrow for the local player.
 *
 * It grows with charge and sits on the desk at the pen's feet, so power and
 * direction are read in the same glance as the board itself rather than from a
 * separate meter.
 */
export function AimIndicator({ slot }: Props): JSX.Element {
  const group = useRef<THREE.Group>(null);
  const shaft = useRef<THREE.Mesh>(null);
  const head = useRef<THREE.Mesh>(null);

  useFrame((_state, delta) => {
    const node = group.current;
    if (!node) return;

    const sample = net.buffer.sample(Date.now());
    const pen = sample?.pens.find((candidate) => candidate.slot === slot);

    const visible = aimState.aiming && Boolean(pen) && pen?.eliminated === false;
    node.visible = visible;
    if (!visible || !pen) return;

    node.position.set(pen.position.x, DESK_TOP_Y + 0.02, pen.position.z);
    node.rotation.y = Math.atan2(aimState.dirX, aimState.dirZ);

    const length = 0.9 + aimState.power * 3.6;
    if (shaft.current) {
      shaft.current.scale.set(1, 1, length);
      shaft.current.position.set(0, 0, length / 2 + 0.35);
    }
    if (head.current) {
      head.current.position.set(0, 0, length + 0.45);
      const scale = 1 + aimState.power * 0.5;
      head.current.scale.setScalar(THREE.MathUtils.damp(head.current.scale.x, scale, 12, delta));
    }
  });

  const colour = slot === 'A' ? '#6fa8ff' : '#ff7b6f';

  return (
    <group ref={group} visible={false}>
      <mesh ref={shaft}>
        <boxGeometry args={[0.1, 0.008, 1]} />
        <meshBasicMaterial color={colour} transparent opacity={0.85} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh ref={head} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.22, 0.5, 4]} />
        <meshBasicMaterial color={colour} transparent opacity={0.95} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
}
