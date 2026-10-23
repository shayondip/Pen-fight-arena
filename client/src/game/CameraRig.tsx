import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { DESK_TOP_Y } from '@pfa/shared';
import type { PlayerSlot } from '@pfa/shared';

import { net } from '../net/socket.js';

interface Props {
  slot: PlayerSlot | null;
}

/**
 * Smooth third-person camera.
 *
 * Each seat gets its own side of the desk so "push away from me" always means
 * the same thing on screen. The camera drifts slightly towards the action and
 * is damped frame-rate independently, which keeps it steady during a scramble
 * without feeling floaty.
 */
export function CameraRig({ slot }: Props): JSX.Element | null {
  const camera = useThree((state) => state.camera);
  const lookTarget = useRef(new THREE.Vector3(0, DESK_TOP_Y + 0.4, 0));
  const desired = useRef(new THREE.Vector3());

  useFrame((_state, delta) => {
    const side = slot === 'B' ? 1 : -1;
    const spectator = slot === null;

    const sample = net.buffer.sample(Date.now());

    // Follow the midpoint of the two pens, gently.
    let focusX = 0;
    let focusZ = 0;
    if (sample && sample.pens.length > 0) {
      for (const pen of sample.pens) {
        focusX += pen.position.x;
        focusZ += pen.position.z;
      }
      focusX /= sample.pens.length;
      focusZ /= sample.pens.length;
    }

    if (spectator) {
      desired.current.set(0, 17.5, 17);
    } else {
      desired.current.set(side * 13.4 + focusX * 0.1, 12.8, focusZ * 0.35);
    }

    const smoothing = 1 - Math.exp(-3.2 * delta);
    camera.position.lerp(desired.current, smoothing);

    lookTarget.current.lerp(
      new THREE.Vector3(focusX * 0.45, DESK_TOP_Y + 0.5, focusZ * 0.45),
      smoothing,
    );
    camera.lookAt(lookTarget.current);
  });

  return null;
}
