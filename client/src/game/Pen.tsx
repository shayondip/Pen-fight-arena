import { forwardRef, useMemo } from 'react';
import * as THREE from 'three';

import { PEN_LENGTH, PEN_RADIUS, getSkin } from '@pfa/shared';
import type { PlayerSlot } from '@pfa/shared';

interface Props {
  skinId: string;
  slot: PlayerSlot;
  /** Dimmed once the pen is out of the match. */
  eliminated?: boolean;
}

const HALF = PEN_LENGTH / 2;

/**
 * A ballpoint pen, modelled part by part along its local +Y axis so it lines up
 * exactly with the capsule collider the server simulates.
 *
 * From the writing end: a steel ball, a tapered cone, a moulded rubber grip,
 * the barrel with its ink window, a coloured accent band, the cap and its clip.
 * Nothing here is loaded from a file - it is all primitives and materials.
 */
export const Pen = forwardRef<THREE.Group, Props>(function Pen(
  { skinId, slot, eliminated = false },
  ref,
) {
  const skin = useMemo(() => getSkin(skinId), [skinId]);

  // Player colour stays readable whatever cosmetic skin is equipped.
  const teamColour = slot === 'A' ? '#4d8dff' : '#ff5a4d';
  const opacity = eliminated ? 0.45 : 1;

  const barrelMaterial = (
    <meshStandardMaterial
      color={skin.barrel}
      roughness={skin.roughness}
      metalness={skin.metalness}
      transparent={eliminated}
      opacity={opacity}
    />
  );

  return (
    <group ref={ref}>
      {/* Steel ball tip. */}
      <mesh position={[0, -HALF + 0.015, 0]} castShadow>
        <sphereGeometry args={[PEN_RADIUS * 0.3, 10, 8]} />
        <meshStandardMaterial color="#d8dde4" roughness={0.18} metalness={0.95} />
      </mesh>

      {/* Brass cone that holds the refill. */}
      <mesh position={[0, -HALF + 0.09, 0]} castShadow>
        <cylinderGeometry args={[PEN_RADIUS * 0.26, PEN_RADIUS * 0.82, 0.16, 14]} />
        <meshStandardMaterial color="#c9b280" roughness={0.3} metalness={0.85} />
      </mesh>

      {/* Tapered nose. */}
      <mesh position={[0, -HALF + 0.26, 0]} castShadow>
        <cylinderGeometry args={[PEN_RADIUS * 0.82, PEN_RADIUS * 1.06, 0.2, 16]} />
        <meshStandardMaterial
          color={skin.grip}
          roughness={0.5}
          metalness={skin.metalness * 0.6}
          transparent={eliminated}
          opacity={opacity}
        />
      </mesh>

      {/* Rubber grip. */}
      <mesh position={[0, -HALF + 0.52, 0]} castShadow>
        <cylinderGeometry args={[PEN_RADIUS * 1.12, PEN_RADIUS * 1.12, 0.34, 16]} />
        <meshStandardMaterial
          color={skin.grip}
          roughness={0.95}
          metalness={0}
          transparent={eliminated}
          opacity={opacity}
        />
      </mesh>

      {/* Main barrel. */}
      <mesh position={[0, 0.08, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[PEN_RADIUS, PEN_RADIUS * 1.04, 0.86, 18]} />
        {barrelMaterial}
      </mesh>

      {/* Optional cosmetic stripes. */}
      {skin.stripes
        ? [-0.18, 0.06, 0.3].map((y) => (
            <mesh key={y} position={[0, y, 0]}>
              <cylinderGeometry args={[PEN_RADIUS * 1.03, PEN_RADIUS * 1.03, 0.05, 18]} />
              <meshStandardMaterial
                color={skin.accent}
                roughness={0.35}
                metalness={skin.metalness}
              />
            </mesh>
          ))
        : null}

      {/* Team band - always visible so you can tell the pens apart. */}
      <mesh position={[0, 0.46, 0]}>
        <cylinderGeometry args={[PEN_RADIUS * 1.14, PEN_RADIUS * 1.14, 0.09, 18]} />
        <meshStandardMaterial
          color={teamColour}
          emissive={teamColour}
          emissiveIntensity={eliminated ? 0.1 : 0.45}
          roughness={0.4}
        />
      </mesh>

      {/* Cap. */}
      <mesh position={[0, HALF - 0.17, 0]} castShadow>
        <cylinderGeometry args={[PEN_RADIUS * 1.08, PEN_RADIUS * 1.08, 0.3, 18]} />
        <meshStandardMaterial
          color={skin.cap}
          roughness={skin.roughness * 0.8}
          metalness={skin.metalness}
          transparent={eliminated}
          opacity={opacity}
        />
      </mesh>

      {/* Domed cap end. */}
      <mesh position={[0, HALF - 0.02, 0]} castShadow>
        <sphereGeometry args={[PEN_RADIUS * 1.08, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={skin.cap} roughness={0.45} metalness={skin.metalness} />
      </mesh>

      {/* Pocket clip. */}
      <mesh position={[PEN_RADIUS * 1.2, HALF - 0.2, 0]} castShadow>
        <boxGeometry args={[0.022, 0.34, PEN_RADIUS * 1.1]} />
        <meshStandardMaterial color={skin.accent} roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh position={[PEN_RADIUS * 1.18, HALF - 0.38, 0]} castShadow>
        <boxGeometry args={[0.03, 0.06, PEN_RADIUS * 1.1]} />
        <meshStandardMaterial color={skin.accent} roughness={0.3} metalness={0.6} />
      </mesh>
    </group>
  );
});
