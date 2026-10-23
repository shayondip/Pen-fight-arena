import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { DESK_HALF_X, DESK_HALF_Z, DESK_TOP_Y } from '@pfa/shared';

import { net } from '../net/socket.js';

const MARKER_HEIGHT = DESK_TOP_Y + 0.012;
const BAR_THICKNESS = 0.07;

/**
 * The marked valid playing area.
 *
 * Four bars drawn flat on the desk, all sharing one material so the shrink
 * warning is a single colour change rather than four. The bars stay at full
 * size for the opening minute and then close in, which is what stops two
 * cautious players from stalling out the clock. Their extents come straight
 * from the server snapshot, so the line you see is the line being judged.
 */
export function Boundary(): JSX.Element {
  const north = useRef<THREE.Mesh>(null);
  const south = useRef<THREE.Mesh>(null);
  const east = useRef<THREE.Mesh>(null);
  const west = useRef<THREE.Mesh>(null);

  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#eaf2ff'),
        transparent: true,
        opacity: 0.45,
        toneMapped: false,
        depthWrite: false,
      }),
    [],
  );

  useEffect(() => () => material.dispose(), [material]);

  useFrame((_state, delta) => {
    const sample = net.buffer.sample(Date.now());
    if (!sample) return;

    const { halfX, halfZ } = sample.area;
    const shrinking = halfX < DESK_HALF_X - 0.01;

    north.current?.position.set(0, MARKER_HEIGHT, -halfZ);
    north.current?.scale.set(halfX * 2 + BAR_THICKNESS, 1, 1);

    south.current?.position.set(0, MARKER_HEIGHT, halfZ);
    south.current?.scale.set(halfX * 2 + BAR_THICKNESS, 1, 1);

    west.current?.position.set(-halfX, MARKER_HEIGHT, 0);
    west.current?.scale.set(1, 1, halfZ * 2 + BAR_THICKNESS);

    east.current?.position.set(halfX, MARKER_HEIGHT, 0);
    east.current?.scale.set(1, 1, halfZ * 2 + BAR_THICKNESS);

    const pulse = shrinking ? 0.18 * Math.sin(performance.now() / 180) : 0;
    material.opacity = THREE.MathUtils.damp(
      material.opacity,
      (shrinking ? 0.85 : 0.4) + pulse,
      6,
      delta,
    );
    material.color.lerp(new THREE.Color(shrinking ? '#ff8a4c' : '#eaf2ff'), 1 - Math.exp(-4 * delta));
  });

  return (
    <group>
      <mesh ref={north} position={[0, MARKER_HEIGHT, -DESK_HALF_Z]} material={material}>
        <boxGeometry args={[1, 0.006, BAR_THICKNESS]} />
      </mesh>
      <mesh ref={south} position={[0, MARKER_HEIGHT, DESK_HALF_Z]} material={material}>
        <boxGeometry args={[1, 0.006, BAR_THICKNESS]} />
      </mesh>
      <mesh ref={west} position={[-DESK_HALF_X, MARKER_HEIGHT, 0]} material={material}>
        <boxGeometry args={[BAR_THICKNESS, 0.006, 1]} />
      </mesh>
      <mesh ref={east} position={[DESK_HALF_X, MARKER_HEIGHT, 0]} material={material}>
        <boxGeometry args={[BAR_THICKNESS, 0.006, 1]} />
      </mesh>
    </group>
  );
}
