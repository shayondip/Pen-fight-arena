import { useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';

import { hashSeed, mulberry32 } from '@pfa/shared';
import type { ArenaPreset } from '@pfa/shared';

import { createGrassTexture } from './textures.js';

interface Props {
  arena: ArenaPreset;
}

const FIELD_SIZE = 400;
/** Trees are kept outside this radius so they never crowd the desk. */
const TREE_INNER_RADIUS = 34;
const TREE_OUTER_RADIUS = 125;

/**
 * The field the desk stands on, plus a ring of distant trees.
 *
 * Trees are two instanced meshes (trunks and canopies) placed from a seeded
 * RNG, so a given arena always looks the same, the whole treeline costs two
 * draw calls, and none of it casts shadows - they are scenery, far from the
 * action, and shadow-casting them would spend the shadow budget on nothing.
 */
export function Ground({ arena }: Props): JSX.Element {
  const grass = useMemo(
    () => createGrassTexture(arena.grass.base, arena.grass.accent),
    [arena.grass.base, arena.grass.accent],
  );

  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const canopyRef = useRef<THREE.InstancedMesh>(null);

  const trees = useMemo(() => {
    const random = mulberry32(hashSeed(`trees:${arena.id}`));
    const count = arena.trees.count;
    const out: { x: number; z: number; height: number; width: number; tilt: number }[] = [];

    for (let i = 0; i < count; i += 1) {
      const angle = random() * Math.PI * 2;
      const radius = TREE_INNER_RADIUS + random() * (TREE_OUTER_RADIUS - TREE_INNER_RADIUS);
      out.push({
        x: Math.cos(angle) * radius,
        z: Math.sin(angle) * radius,
        height: 12 + random() * 20,
        width: 4 + random() * 5,
        tilt: (random() - 0.5) * 0.12,
      });
    }
    return out;
  }, [arena.id, arena.trees.count]);

  useLayoutEffect(() => {
    const trunk = trunkRef.current;
    const canopy = canopyRef.current;
    if (!trunk || !canopy) return;

    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const euler = new THREE.Euler();

    trees.forEach((tree, index) => {
      const trunkHeight = tree.height * 0.45;

      euler.set(tree.tilt, index * 0.7, tree.tilt * 0.6);
      quaternion.setFromEuler(euler);

      position.set(tree.x, trunkHeight / 2, tree.z);
      scale.set(tree.width * 0.12, trunkHeight, tree.width * 0.12);
      matrix.compose(position, quaternion, scale);
      trunk.setMatrixAt(index, matrix);

      position.set(tree.x, trunkHeight + tree.height * 0.3, tree.z);
      scale.set(tree.width, tree.height * 0.62, tree.width);
      matrix.compose(position, quaternion, scale);
      canopy.setMatrixAt(index, matrix);
    });

    trunk.instanceMatrix.needsUpdate = true;
    canopy.instanceMatrix.needsUpdate = true;
    trunk.computeBoundingSphere();
    canopy.computeBoundingSphere();
  }, [trees]);

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[FIELD_SIZE, FIELD_SIZE]} />
        <meshStandardMaterial map={grass} roughness={0.95} metalness={0} />
      </mesh>

      <instancedMesh ref={trunkRef} args={[undefined, undefined, trees.length]} frustumCulled>
        <cylinderGeometry args={[0.8, 1, 1, 6]} />
        <meshStandardMaterial color={arena.trees.trunk} roughness={0.9} />
      </instancedMesh>

      <instancedMesh ref={canopyRef} args={[undefined, undefined, trees.length]} frustumCulled>
        <icosahedronGeometry args={[0.5, 0]} />
        <meshStandardMaterial color={arena.trees.canopy} roughness={0.85} flatShading />
      </instancedMesh>
    </group>
  );
}
