import { useEffect, useRef } from 'react';

import { MIN_CHARGE_MS, clamp, clamp01, rotate2 } from '@pfa/shared';
import type { PlayerSlot } from '@pfa/shared';

import { sfx } from '../audio/sfx.js';
import { aimState, basisFor, resetAim } from '../game/aimState.js';
import { net } from '../net/socket.js';
import { store } from '../state/store.js';

interface Options {
  slot: PlayerSlot | null;
  enabled: boolean;
  sensitivity: number;
}

/** Largest useful keyboard aim swing either side of straight ahead. */
const MAX_AIM_ANGLE = (80 * Math.PI) / 180;

/**
 * Aim, charge and release - on mouse, touch and keyboard.
 *
 * Pointer input is a slingshot: press, drag back, let go. Dragging away from
 * the target is how a real flick feels, and it keeps the finger clear of the
 * pen on a phone. Keyboard play gets the same model with Left/Right to turn and
 * Space held to charge.
 *
 * A release faster than the server's minimum charge is held back the few extra
 * milliseconds rather than sent and rejected, so an eager tap still fires.
 */
export function useAimControls({ slot, enabled, sensitivity }: Options): void {
  const chargeStartedAt = useRef<number | null>(null);
  const dragOrigin = useRef<{ x: number; y: number } | null>(null);
  const keyboardAngle = useRef(0);
  const pendingFire = useRef<number | null>(null);

  useEffect(() => {
    resetAim(slot);
    keyboardAngle.current = 0;
  }, [slot]);

  useEffect(() => {
    if (!enabled || !slot) return;

    const maxDrag =
      Math.max(90, Math.min(220, 0.3 * Math.min(window.innerWidth, window.innerHeight))) /
      Math.max(0.4, sensitivity);

    const beginCharge = (): void => {
      if (chargeStartedAt.current !== null) return;
      chargeStartedAt.current = Date.now();
      aimState.aiming = true;
      aimState.slot = slot;
      net.setCharging(true);
      sfx.unlock();
      sfx.startCharge();
    };

    const release = (): void => {
      const startedAt = chargeStartedAt.current;
      if (startedAt === null) return;

      const power = aimState.power;
      const dirX = aimState.dirX;
      const dirZ = aimState.dirZ;

      chargeStartedAt.current = null;
      dragOrigin.current = null;
      aimState.aiming = false;
      aimState.power = 0;
      sfx.stopCharge();

      if (power < 0.06) {
        net.setCharging(false);
        return;
      }

      const held = Date.now() - startedAt;
      const wait = Math.max(0, MIN_CHARGE_MS + 15 - held);

      const send = (): void => {
        pendingFire.current = null;
        net.fire(dirX, dirZ, power);
        sfx.play('fire', power);
      };

      if (wait > 0) {
        pendingFire.current = window.setTimeout(send, wait);
      } else {
        send();
      }
    };

    const cancel = (): void => {
      chargeStartedAt.current = null;
      dragOrigin.current = null;
      aimState.aiming = false;
      aimState.power = 0;
      sfx.stopCharge();
      net.setCharging(false);
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      const target = event.target as HTMLElement | null;
      // Let the HUD buttons work normally.
      if (target?.closest('[data-ui-layer="true"]')) return;

      dragOrigin.current = { x: event.clientX, y: event.clientY };
      beginCharge();
    };

    const onPointerMove = (event: PointerEvent): void => {
      const origin = dragOrigin.current;
      if (!origin) return;

      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      const distance = Math.hypot(dx, dy);

      aimState.power = clamp01(distance / maxDrag);
      if (distance < 6) return;

      // Slingshot: the pen goes the opposite way to the drag.
      const basis = basisFor(slot);
      const worldX = basis.awayX * dy + basis.rightX * -dx;
      const worldZ = basis.awayZ * dy + basis.rightZ * -dx;
      const length = Math.hypot(worldX, worldZ);
      if (length < 1e-4) return;

      aimState.dirX = worldX / length;
      aimState.dirZ = worldZ / length;
    };

    const onPointerUp = (): void => {
      if (dragOrigin.current) release();
    };

    const applyKeyboardAim = (): void => {
      const basis = basisFor(slot);
      const rotated = rotate2(basis.awayX, basis.awayZ, keyboardAngle.current);
      aimState.dirX = rotated.x;
      aimState.dirZ = rotated.z;
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.repeat && event.code !== 'ArrowLeft' && event.code !== 'ArrowRight' &&
          event.code !== 'KeyA' && event.code !== 'KeyD') {
        return;
      }

      switch (event.code) {
        case 'ArrowLeft':
        case 'KeyA':
          keyboardAngle.current = clamp(keyboardAngle.current - 0.06, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
          applyKeyboardAim();
          event.preventDefault();
          break;
        case 'ArrowRight':
        case 'KeyD':
          keyboardAngle.current = clamp(keyboardAngle.current + 0.06, -MAX_AIM_ANGLE, MAX_AIM_ANGLE);
          applyKeyboardAim();
          event.preventDefault();
          break;
        case 'Space':
          event.preventDefault();
          if (chargeStartedAt.current === null) {
            applyKeyboardAim();
            beginCharge();
          }
          break;
        case 'Escape':
          cancel();
          break;
        default:
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      if (chargeStartedAt.current !== null && dragOrigin.current === null) release();
    };

    // Keyboard charge builds on a timer because there is no drag distance.
    const chargeTimer = window.setInterval(() => {
      if (chargeStartedAt.current === null || dragOrigin.current !== null) return;
      const held = Date.now() - chargeStartedAt.current;
      aimState.power = clamp01(held / 1400);
    }, 33);

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', cancel);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', cancel);
      window.clearInterval(chargeTimer);
      if (pendingFire.current !== null) window.clearTimeout(pendingFire.current);
      sfx.stopCharge();
    };
  }, [enabled, slot, sensitivity]);

  useEffect(() => {
    if (enabled) return;
    aimState.aiming = false;
    aimState.power = 0;
  }, [enabled]);
}

/** Keeps the sound engine's gain in step with the settings screen. */
export function useVolumeSync(): void {
  useEffect(() => store.subscribe(() => sfx.syncVolume()), []);
}
