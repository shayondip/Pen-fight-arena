import type { PlayerSlot } from '@pfa/shared';

/**
 * Live aim state, deliberately kept outside React.
 *
 * Pointer and key handlers write to it many times a second and the render loop
 * reads it every frame. Routing that through component state would re-render
 * the scene on every mouse move for no benefit.
 */
export interface AimState {
  aiming: boolean;
  /** Unit direction in world XZ. */
  dirX: number;
  dirZ: number;
  power: number;
  /** Which way is "away from the camera" for the local player. */
  slot: PlayerSlot | null;
}

export const aimState: AimState = {
  aiming: false,
  dirX: 1,
  dirZ: 0,
  power: 0,
  slot: null,
};

/**
 * Screen-space basis for a seat.
 *
 * Player A sits on -X and looks along +X, so dragging right on screen moves
 * along +Z. Player B is the mirror image. Returning this as plain numbers keeps
 * the input maths independent of the camera object.
 */
export function basisFor(slot: PlayerSlot | null): {
  awayX: number;
  awayZ: number;
  rightX: number;
  rightZ: number;
} {
  if (slot === 'B') {
    return { awayX: -1, awayZ: 0, rightX: 0, rightZ: -1 };
  }
  return { awayX: 1, awayZ: 0, rightX: 0, rightZ: 1 };
}

export function resetAim(slot: PlayerSlot | null): void {
  const basis = basisFor(slot);
  aimState.aiming = false;
  aimState.power = 0;
  aimState.dirX = basis.awayX;
  aimState.dirZ = basis.awayZ;
  aimState.slot = slot;
}
