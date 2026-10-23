import { useMemo } from 'react';

import {
  DESK_HALF_X,
  DESK_HALF_Z,
  DESK_LEG_INSET,
  DESK_THICKNESS,
  DESK_TOP_Y,
} from '@pfa/shared';
import type { ArenaPreset } from '@pfa/shared';

import { createPaperTexture, createWoodTexture } from './textures.js';

interface Props {
  arena: ArenaPreset;
}

/**
 * A school desk: a thick planed top with a chamfered lip, four tapered legs
 * braced near the floor, a metal frame rail, and a sheet of ruled paper taped
 * off to one side. The top face sits exactly at DESK_TOP_Y, which is the same
 * constant the server's collider uses, so what you see is what the pens hit.
 */
export function Desk({ arena }: Props): JSX.Element {
  const wood = useMemo(
    () => createWoodTexture(arena.desk.wood, arena.desk.grain),
    [arena.desk.wood, arena.desk.grain],
  );
  const paper = useMemo(() => createPaperTexture(), []);

  const topCentreY = DESK_TOP_Y - DESK_THICKNESS / 2;
  const legHeight = topCentreY - DESK_THICKNESS / 2;
  const legX = DESK_HALF_X - DESK_LEG_INSET;
  const legZ = DESK_HALF_Z - DESK_LEG_INSET;

  const legPositions: [number, number][] = [
    [-legX, -legZ],
    [legX, -legZ],
    [-legX, legZ],
    [legX, legZ],
  ];

  return (
    <group>
      {/* Top slab. */}
      <mesh position={[0, topCentreY, 0]} castShadow receiveShadow>
        <boxGeometry args={[DESK_HALF_X * 2, DESK_THICKNESS, DESK_HALF_Z * 2]} />
        <meshStandardMaterial map={wood} roughness={0.52} metalness={0.04} />
      </mesh>

      {/* Chamfered lip, slightly proud of the slab, reads as a rounded edge. */}
      <mesh position={[0, topCentreY - DESK_THICKNESS * 0.42, 0]} receiveShadow>
        <boxGeometry args={[DESK_HALF_X * 2 + 0.12, DESK_THICKNESS * 0.3, DESK_HALF_Z * 2 + 0.12]} />
        <meshStandardMaterial color={arena.desk.grain} roughness={0.62} />
      </mesh>

      {/* Ruled sheet, off to the back-left so it never sits under the pens. */}
      <mesh
        position={[-DESK_HALF_X * 0.52, DESK_TOP_Y + 0.006, -DESK_HALF_Z * 0.58]}
        rotation={[-Math.PI / 2, 0, 0.07]}
        receiveShadow
      >
        <planeGeometry args={[3.1, 2.3]} />
        <meshStandardMaterial map={paper} roughness={0.9} />
      </mesh>

      {legPositions.map(([x, z], index) => (
        <mesh key={index} position={[x, legHeight / 2, z]} castShadow receiveShadow>
          <cylinderGeometry args={[0.16, 0.2, legHeight, 12]} />
          <meshStandardMaterial color={arena.desk.metal} roughness={0.38} metalness={0.75} />
        </mesh>
      ))}

      {/* Cross braces between the leg pairs. */}
      {[-legZ, legZ].map((z) => (
        <mesh key={`brace-${z}`} position={[0, legHeight * 0.22, z]} castShadow>
          <boxGeometry args={[legX * 2, 0.14, 0.14]} />
          <meshStandardMaterial color={arena.desk.metal} roughness={0.4} metalness={0.7} />
        </mesh>
      ))}

      <mesh position={[0, legHeight * 0.22, 0]} castShadow>
        <boxGeometry args={[0.14, 0.14, legZ * 2]} />
        <meshStandardMaterial color={arena.desk.metal} roughness={0.4} metalness={0.7} />
      </mesh>
    </group>
  );
}
