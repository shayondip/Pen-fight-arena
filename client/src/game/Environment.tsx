import { Sky } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import { DESK_TOP_Y } from '@pfa/shared';
import type { ArenaPreset } from '@pfa/shared';

interface Props {
  arena: ArenaPreset;
  quality: 'low' | 'medium' | 'high';
}

/**
 * Sky, fog and lighting for the selected arena.
 *
 * drei's <Sky> is an analytic Preetham sky - no HDRI download - and the sun
 * light is re-aimed onto the desk with a tight shadow frustum so the pens cast
 * crisp shadows instead of the mush you get from a frustum sized for the whole
 * field.
 */
export function ArenaEnvironment({ arena, quality }: Props): JSX.Element {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const targetRef = useRef<THREE.Object3D>(null);

  const sunDirection = useMemo(() => {
    const [x, y, z] = arena.lights.sun.position;
    return new THREE.Vector3(x, y, z).normalize().multiplyScalar(42);
  }, [arena]);

  const shadowMapSize = quality === 'low' ? 1024 : quality === 'medium' ? 2048 : 4096;

  return (
    <>
      <fog attach="fog" args={[arena.fog.color, arena.fog.near, arena.fog.far]} />

      <Sky
        distance={4000}
        turbidity={arena.sky.turbidity}
        rayleigh={arena.sky.rayleigh}
        mieCoefficient={arena.sky.mieCoefficient}
        mieDirectionalG={arena.sky.mieDirectionalG}
        sunPosition={arena.sky.sunPosition}
      />

      <ambientLight color={arena.lights.ambient.color} intensity={arena.lights.ambient.intensity} />
      <hemisphereLight
        color={arena.lights.hemisphere.sky}
        groundColor={arena.lights.hemisphere.ground}
        intensity={arena.lights.hemisphere.intensity}
      />

      <object3D ref={targetRef} position={[0, DESK_TOP_Y, 0]} />

      <directionalLight
        ref={lightRef}
        color={arena.lights.sun.color}
        intensity={arena.lights.sun.intensity}
        position={[sunDirection.x, Math.max(14, sunDirection.y), sunDirection.z]}
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={1}
        shadow-camera-far={120}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0008}
        shadow-normalBias={0.02}
        target={targetRef.current ?? undefined}
      />

      {/* A soft fill from the opposite side keeps the shadowed half of each pen readable. */}
      <directionalLight
        color={arena.lights.hemisphere.sky}
        intensity={0.35}
        position={[-sunDirection.x, 20, -sunDirection.z]}
      />
    </>
  );
}
