// A crew member outside the ship: standing on a body, or on a tether in vacuum.
//
// Position is body-local float64, like everything else that moves in this game. The
// walking frame is rebuilt from the local up every step rather than stored, because on a
// sphere there is no global "north" that stays useful once you have walked a few hundred
// kilometres.

import { vec3, set, copy, add, sub, scale, addScaled, dot, cross, length, normalize } from '../shared/vec3.js';
import { gravityAt } from '../shared/orbit.js';
import { BODIES } from '../shared/bodies.js';

export const SUIT = {
  eyeHeight: 1.62,
  walkSpeed: 2.6,
  runSpeed: 4.4,
  jumpSpeed: 3.4,
  jetAcceleration: 3.8,
  jetDamping: 0.35,
  oxygenSeconds: 1200,
  bottleSeconds: 600,
  tetherLength: 90,
  tetherStiffness: 2.4,
  fallLimit: 9,
};

// Air is a place, not a planet. Standing in a meadow on Earth needs no helmet; being in
// orbit above the same meadow very much does, and the body underneath is identical.
const BREATHING_CEILING = 5000;

export function needsSuit(bodyId, altitude) {
  if (bodyId !== 'earth') return true;
  return altitude > BREATHING_CEILING;
}

const up = vec3();
const north = vec3();
const east = vec3();
const wish = vec3();
const gravity = vec3();
const scratch = vec3();
const tetherVector = vec3();

export function createAstronaut(bodyId, position) {
  return {
    frame: bodyId,
    position: copy(vec3(), position),
    velocity: vec3(),
    yaw: 0,
    pitch: 0,
    onGround: false,
    mode: 'surface',
    oxygen: SUIT.oxygenSeconds,
    bottles: 2,
    tethered: true,
    health: 1,
    down: false,
    altitude: 0,
    slope: 0,
  };
}

// The local frame: up is straight away from the centre, north is whatever is left of the
// body's spin axis after removing the part that points up, and east closes the triad.
export function localFrame(position, outUp = up, outNorth = north, outEast = east) {
  normalize(outUp, position);
  set(outNorth, 0, 1, 0);
  addScaled(outNorth, outNorth, outUp, -dot(outNorth, outUp));
  if (length(outNorth) < 1e-6) set(outNorth, 1, 0, 0);
  normalize(outNorth, outNorth);
  cross(outEast, outNorth, outUp);
  normalize(outEast, outEast);
  return { up: outUp, north: outNorth, east: outEast };
}

export function lookDirection(astronaut, out = vec3()) {
  const frame = localFrame(astronaut.position);
  const cy = Math.cos(astronaut.yaw);
  const sy = Math.sin(astronaut.yaw);
  const cp = Math.cos(astronaut.pitch);
  const sp = Math.sin(astronaut.pitch);
  set(out, 0, 0, 0);
  addScaled(out, out, frame.north, cy * cp);
  addScaled(out, out, frame.east, sy * cp);
  addScaled(out, out, frame.up, sp);
  return normalize(out, out);
}

export function updateAstronaut(astronaut, input, environment, dt) {
  const step = Math.min(0.05, dt);
  const body = BODIES[astronaut.frame];
  const frame = localFrame(astronaut.position);
  const radius = length(astronaut.position);
  const groundRadius = body.radius + environment.groundHeight;
  astronaut.altitude = radius - groundRadius;

  // Whether you are on a surface or on a tether is a fact about where you are, not a
  // decision made once when you opened the door. Stepping off a ledge, or drifting down
  // onto the regolith, changes it by itself.
  astronaut.mode = astronaut.altitude < 300 ? 'surface' : 'eva';

  const vacuum = needsSuit(astronaut.frame, astronaut.altitude);
  astronaut.sealed = vacuum;
  if (vacuum && astronaut.mode !== 'aboard') {
    astronaut.oxygen -= step;
    if (astronaut.oxygen <= 0 && astronaut.bottles > 0) {
      astronaut.bottles -= 1;
      astronaut.oxygen = SUIT.bottleSeconds;
    }
    if (astronaut.oxygen <= 0) astronaut.down = true;
  }

  const cy = Math.cos(astronaut.yaw);
  const sy = Math.sin(astronaut.yaw);
  set(wish, 0, 0, 0);
  addScaled(wish, wish, frame.north, input.forward * cy - input.strafe * sy);
  addScaled(wish, wish, frame.east, input.forward * sy + input.strafe * cy);
  const wishLength = length(wish);
  if (wishLength > 0) scale(wish, wish, 1 / wishLength);

  if (astronaut.mode === 'eva') {
    // Jetpack pushes wherever the visor is pointing; there is nothing to push back.
    lookDirection(astronaut, scratch);
    addScaled(astronaut.velocity, astronaut.velocity, scratch, input.forward * SUIT.jetAcceleration * step);
    addScaled(astronaut.velocity, astronaut.velocity, frame.east, input.strafe * SUIT.jetAcceleration * step);
    addScaled(astronaut.velocity, astronaut.velocity, frame.up, input.vertical * SUIT.jetAcceleration * step);
    gravityAt(astronaut.frame, astronaut.position, gravity);
    addScaled(astronaut.velocity, astronaut.velocity, gravity, step);

    // Station-keeping damps towards the SHIP, not towards zero. There is nothing in
    // vacuum to slow down against, and damping an absolute velocity would quietly drag
    // an astronaut in orbit out of it while they were only trying to hold position.
    if (environment.anchorVelocity) {
      sub(scratch, astronaut.velocity, environment.anchorVelocity);
      addScaled(astronaut.velocity, astronaut.velocity, scratch, -SUIT.jetDamping * step);
    }

    // The tether is the difference between a mistake and the end of the session.
    if (astronaut.tethered && environment.anchor) {
      sub(tetherVector, astronaut.position, environment.anchor);
      const distance = length(tetherVector);
      if (distance > SUIT.tetherLength) {
        scale(tetherVector, tetherVector, 1 / distance);
        const excess = distance - SUIT.tetherLength;
        addScaled(astronaut.velocity, astronaut.velocity, tetherVector, -excess * SUIT.tetherStiffness * step);
        addScaled(astronaut.position, astronaut.position, tetherVector, -excess);
      }
    }
    addScaled(astronaut.position, astronaut.position, astronaut.velocity, step);
    astronaut.onGround = false;
    return astronaut;
  }

  gravityAt(astronaut.frame, astronaut.position, gravity);
  addScaled(astronaut.velocity, astronaut.velocity, gravity, step);

  const vertical = dot(astronaut.velocity, frame.up);
  if (astronaut.onGround) {
    const speed = input.run ? SUIT.runSpeed : SUIT.walkSpeed;
    addScaled(astronaut.velocity, wish, frame.up, vertical / speed);
    scale(astronaut.velocity, astronaut.velocity, speed);
    if (input.jump) addScaled(astronaut.velocity, astronaut.velocity, frame.up, SUIT.jumpSpeed);
  } else {
    addScaled(astronaut.velocity, astronaut.velocity, wish, SUIT.walkSpeed * 0.6 * step);
  }

  addScaled(astronaut.position, astronaut.position, astronaut.velocity, step);

  const newRadius = length(astronaut.position);
  const floor = groundRadius + SUIT.eyeHeight * 0;
  if (newRadius < floor) {
    const impact = -dot(astronaut.velocity, frame.up);
    if (impact > SUIT.fallLimit) {
      astronaut.health = Math.max(0, astronaut.health - (impact - SUIT.fallLimit) / 14);
      if (astronaut.health <= 0) astronaut.down = true;
    }
    scale(astronaut.position, astronaut.position, floor / newRadius);
    addScaled(astronaut.velocity, astronaut.velocity, frame.up, -dot(astronaut.velocity, frame.up));
    astronaut.onGround = true;
  } else if (newRadius > floor + 0.15) {
    astronaut.onGround = false;
  }

  return astronaut;
}

export function refill(astronaut) {
  astronaut.oxygen = SUIT.oxygenSeconds;
  astronaut.bottles = 2;
  astronaut.health = Math.min(1, astronaut.health + 0.5);
  astronaut.down = false;
}
