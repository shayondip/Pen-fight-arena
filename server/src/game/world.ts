import RAPIER from '@dimforge/rapier3d-compat';
import type { Collider, EventQueue, RigidBody, World } from '@dimforge/rapier3d-compat';

import {
  DESK_FRICTION,
  DESK_HALF_X,
  DESK_HALF_Z,
  DESK_RESTITUTION,
  DESK_THICKNESS,
  DESK_TOP_Y,
  GRAVITY_Y,
  PEN_ANGULAR_DAMPING,
  PEN_CAPSULE_HALF_HEIGHT,
  PEN_FRICTION,
  PEN_LINEAR_DAMPING,
  PEN_MASS_KG,
  PEN_RADIUS,
  PEN_RESTITUTION,
  SPAWN_A,
  SPAWN_B,
  SPAWN_ROTATION,
  TICK_HZ,
} from '@pfa/shared';
import type { PenEffects, PlayerSlot, Quat, Vec3 } from '@pfa/shared';

let initialised = false;

/** Loads the Rapier WASM module. Safe to await repeatedly. */
export async function initPhysics(): Promise<void> {
  if (initialised) return;
  await RAPIER.init();
  initialised = true;
}

export function isPhysicsReady(): boolean {
  return initialised;
}

/** Volume of a capsule: cylinder body plus the two hemispherical caps. */
export function capsuleVolume(halfHeight: number, radius: number): number {
  const cylinder = Math.PI * radius * radius * (2 * halfHeight);
  const caps = (4 / 3) * Math.PI * radius * radius * radius;
  return cylinder + caps;
}

/** Rotates a vector by a quaternion (v' = q * v * q^-1), expanded for speed. */
export function rotateByQuat(v: Vec3, q: Quat): Vec3 {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;

  return {
    x: ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
    y: iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
    z: iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x,
  };
}

export interface ArenaWorld {
  world: World;
  eventQueue: EventQueue;
  deskCollider: Collider;
  groundCollider: Collider;
}

/**
 * Builds the physical arena: a fixed desk slab at DESK_TOP_Y and a large
 * ground plane far below it that catches pens once they are knocked off.
 */
export function createArenaWorld(): ArenaWorld {
  if (!initialised) {
    throw new Error('initPhysics() must be awaited before creating a world');
  }

  const world = new RAPIER.World({ x: 0, y: GRAVITY_Y, z: 0 });
  world.timestep = 1 / TICK_HZ;

  const deskBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, DESK_TOP_Y - DESK_THICKNESS / 2, 0),
  );
  const deskCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(DESK_HALF_X, DESK_THICKNESS / 2, DESK_HALF_Z)
      .setFriction(DESK_FRICTION)
      .setRestitution(DESK_RESTITUTION)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    deskBody,
  );

  const groundBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, -2, 0));
  const groundCollider = world.createCollider(
    RAPIER.ColliderDesc.cuboid(120, 2, 120).setFriction(0.9).setRestitution(0.02),
    groundBody,
  );

  const eventQueue = new RAPIER.EventQueue(true);

  return { world, eventQueue, deskCollider, groundCollider };
}

export interface PenHandles {
  body: RigidBody;
  collider: Collider;
}

/**
 * Creates one pen.
 *
 * The collider is a capsule whose axis is local +Y, and the spawn rotation lays
 * that axis flat along world Z. Mass is set through density derived from the
 * real target mass, so Stability levels change the mass ratio between the two
 * pens exactly as designed rather than as a side effect of collider size.
 */
export function createPen(
  world: World,
  slot: PlayerSlot,
  effects: PenEffects,
): PenHandles {
  const spawn = slot === 'A' ? SPAWN_A : SPAWN_B;
  const targetMass = PEN_MASS_KG * effects.massMult;
  const density = targetMass / capsuleVolume(PEN_CAPSULE_HALF_HEIGHT, PEN_RADIUS);

  const body = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setRotation(SPAWN_ROTATION)
      .setLinearDamping(PEN_LINEAR_DAMPING)
      .setAngularDamping(PEN_ANGULAR_DAMPING + effects.angularDampingBonus)
      .setCcdEnabled(true)
      .setCanSleep(false),
  );

  const collider = world.createCollider(
    RAPIER.ColliderDesc.capsule(PEN_CAPSULE_HALF_HEIGHT, PEN_RADIUS)
      .setFriction(PEN_FRICTION + effects.frictionBonus)
      .setRestitution(PEN_RESTITUTION)
      .setDensity(density)
      .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
    body,
  );

  return { body, collider };
}

/** Puts a pen back on its starting mark, fully at rest. */
export function resetPen(body: RigidBody, slot: PlayerSlot): void {
  const spawn = slot === 'A' ? SPAWN_A : SPAWN_B;
  body.setTranslation({ x: spawn.x, y: spawn.y, z: spawn.z }, true);
  body.setRotation(SPAWN_ROTATION, true);
  body.setLinvel({ x: 0, y: 0, z: 0 }, true);
  body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  body.resetForces(true);
  body.resetTorques(true);
}

export function readPosition(body: RigidBody): Vec3 {
  const t = body.translation();
  return { x: t.x, y: t.y, z: t.z };
}

export function readRotation(body: RigidBody): Quat {
  const r = body.rotation();
  return { x: r.x, y: r.y, z: r.z, w: r.w };
}

export function readSpeed(body: RigidBody): number {
  const v = body.linvel();
  return Math.hypot(v.x, v.y, v.z);
}

export function readVelocity(body: RigidBody): Vec3 {
  const v = body.linvel();
  return { x: v.x, y: v.y, z: v.z };
}

/** The pen's long axis in world space, which is its local +Y rotated into place. */
export function readAxis(body: RigidBody): Vec3 {
  return rotateByQuat({ x: 0, y: 1, z: 0 }, readRotation(body));
}

export interface LaunchParams {
  /** Unit direction in the XZ plane. */
  dirX: number;
  dirZ: number;
  /** Desired launch speed in world units per second. */
  speed: number;
}

/**
 * Applies a shot.
 *
 * The impulse is `mass * speed` read back from the body, so shot feel is a
 * property of the design rather than of whatever density the collider ended up
 * with. It is applied slightly off-centre along the pen's own axis, which is
 * what makes a struck pen spin and skid instead of sliding like a brick. A
 * small upward component gives the flick its characteristic hop.
 */
export function launchPen(body: RigidBody, params: LaunchParams): void {
  const mass = body.mass();
  const magnitude = mass * params.speed;

  const impulse = {
    x: params.dirX * magnitude,
    y: magnitude * 0.05,
    z: params.dirZ * magnitude,
  };

  const rotation = readRotation(body);
  const axis = rotateByQuat({ x: 0, y: 1, z: 0 }, rotation);

  // Which way the pen twists follows from the geometry: the sign of the
  // vertical component of (pen axis x aim direction).
  const crossY = axis.z * params.dirX - axis.x * params.dirZ;
  const sign = crossY >= 0 ? 1 : -1;
  const offset = PEN_CAPSULE_HALF_HEIGHT * 0.45 * sign;

  const position = readPosition(body);
  const point = {
    x: position.x + axis.x * offset,
    y: position.y + axis.y * offset,
    z: position.z + axis.z * offset,
  };

  body.applyImpulseAtPoint(impulse, point, true);
}

export { RAPIER };
