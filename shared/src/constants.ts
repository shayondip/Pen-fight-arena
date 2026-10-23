/**
 * World constants.
 *
 * UNITS: one world unit is one decimetre (0.1 m). Keeping the simulation in
 * decimetres rather than metres puts a ballpoint pen (1.5 units long, 0.05
 * units in radius) comfortably inside the size range Rapier's default solver
 * tolerances are tuned for, which avoids the jitter and surface-sinking you get
 * when colliders are only a few millimetres across in a metre-scale world.
 */

export const UNIT_IN_METRES = 0.1;

/** Gravity expressed in world units per second squared (9.81 m/s^2). */
export const GRAVITY_Y = -98.1;

// ---------------------------------------------------------------------------
// Desk
// ---------------------------------------------------------------------------

/** Half-width of the desk top along X (desk is 1.2 m wide). */
export const DESK_HALF_X = 6.0;
/** Half-depth of the desk top along Z (desk is 0.8 m deep). */
export const DESK_HALF_Z = 4.0;
/** Y coordinate of the desk's top face (0.75 m above the grass). */
export const DESK_TOP_Y = 7.5;
export const DESK_THICKNESS = 0.35;
export const DESK_LEG_INSET = 0.6;

// ---------------------------------------------------------------------------
// Pen
// ---------------------------------------------------------------------------

/** Overall pen length: 15 cm. */
export const PEN_LENGTH = 1.5;
/** Barrel radius: 5 mm, i.e. a 1 cm thick pen. */
export const PEN_RADIUS = 0.05;
/** Half height of the capsule's cylindrical section (capsule axis is local +Y). */
export const PEN_CAPSULE_HALF_HEIGHT = (PEN_LENGTH - 2 * PEN_RADIUS) / 2;
/** Reference mass of a pen in kilograms (~8.5 g). */
export const PEN_MASS_KG = 0.0085;

export const PEN_FRICTION = 0.26;
export const PEN_RESTITUTION = 0.26;
export const PEN_LINEAR_DAMPING = 0.12;
export const PEN_ANGULAR_DAMPING = 0.45;

export const DESK_FRICTION = 0.34;
export const DESK_RESTITUTION = 0.05;

/** Resting height of a pen lying on the desk surface. */
export const PEN_REST_Y = DESK_TOP_Y + PEN_RADIUS + 0.004;

/** Spawn positions. Player A sits on -X, player B on +X; both pens lie along Z. */
export const SPAWN_A = { x: -3.2, y: PEN_REST_Y, z: 0 } as const;
export const SPAWN_B = { x: 3.2, y: PEN_REST_Y, z: 0 } as const;

/**
 * Spawn rotation: a 90 degree turn about the X axis maps the capsule's local
 * +Y axis onto world +Z, so each pen lies flat across the desk and presents its
 * full length to an incoming hit.
 */
export const SPAWN_ROTATION = { x: Math.SQRT1_2, y: 0, z: 0, w: Math.SQRT1_2 } as const;

// ---------------------------------------------------------------------------
// Launch model
// ---------------------------------------------------------------------------

/**
 * A shot is expressed as a target speed, not as a raw force. The server reads
 * the pen's actual mass back from Rapier and applies `mass * speed` as an
 * impulse, so the feel of the game does not depend on the density we happen to
 * give the collider.
 *
 * The speed range is set against the geometry rather than guessed. Combined
 * desk/pen friction gives a deceleration of about 0.30 * 98.1 = 29 units/s^2,
 * so a full-power shot coasts roughly 12 units - slightly more than the 9.2 it
 * takes to run off the far edge from a spawn mark. That is the central gamble
 * of the game: a full-power shot that connects usually ends the round, and one
 * that misses usually puts you over the line instead. Firing while over the
 * line is also how you push yourself back in before the grace timer expires.
 */
export const MIN_LAUNCH_SPEED = 8;
export const MAX_LAUNCH_SPEED = 27;

/** Fraction of the launch impulse applied off-centre to make the pen spin. */
export const SPIN_OFFSET = 0.22;

export const BASE_COOLDOWN_MS = 1600;
export const MIN_COOLDOWN_MS = 1000;
export const MIN_CHARGE_MS = 120;
export const MAX_CHARGE_MS = 1400;

// ---------------------------------------------------------------------------
// Match flow
// ---------------------------------------------------------------------------

export const COUNTDOWN_SECONDS = 3;
export const MATCH_DURATION_MS = 120_000;

/** The valid area starts shrinking this far into the match. */
export const SHRINK_START_MS = 55_000;
/** ...and reaches its smallest size here. */
export const SHRINK_END_MS = 105_000;
/** Smallest valid area as a fraction of the full desk. */
export const SHRINK_MIN_SCALE = 0.42;

/** Grace period a pen gets while outside the valid area before it is eliminated. */
export const OUT_OF_BOUNDS_GRACE_MS = 1500;

/** A pen this far below the desk top counts as having fallen off. */
export const FALL_MARGIN = 1.2;

/** Two eliminations inside this window count as a simultaneous knock-out: a draw. */
export const DRAW_WINDOW_MS = 250;

// ---------------------------------------------------------------------------
// Networking
// ---------------------------------------------------------------------------

export const TICK_HZ = 60;
export const TICK_MS = 1000 / TICK_HZ;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_EVERY_N_TICKS = Math.round(TICK_HZ / SNAPSHOT_HZ);

/** Clients render this far in the past so they always interpolate between two known states. */
export const INTERP_DELAY_MS = 110;
export const SNAPSHOT_BUFFER_MS = 1200;

/** How long a disconnected player's seat is held open. */
export const RECONNECT_GRACE_MS = 45_000;

/** Server input budget per socket, enforced with a token bucket. */
export const INPUT_RATE_CAPACITY = 12;
export const INPUT_RATE_REFILL_PER_SEC = 8;

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export const COINS_WIN = 60;
export const COINS_DRAW = 40;
export const COINS_LOSS = 25;
export const COINS_PER_HIT = 3;
export const COINS_HIT_CAP = 30;
export const RANKED_COIN_MULTIPLIER = 1.5;

/**
 * Practice matches against the computer pay less, so the Workshop cannot be
 * farmed by beating Easy on repeat. They also leave rating and the win/loss
 * record untouched, and are never written to the leaderboard.
 */
export const SOLO_COIN_MULTIPLIER = 0.5;
export const STARTING_COINS = 150;

export const STARTING_RATING = 1000;
export const ELO_FLOOR = 100;

export const ROOM_CODE_LENGTH = 5;
export const MIN_NICKNAME_LENGTH = 2;
export const MAX_NICKNAME_LENGTH = 16;
