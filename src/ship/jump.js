// The jump drive: the one piece of technology in this game that physics does not have to
// approve of. Everything else - orbits, thrust, air, gravity - stays honest, which is
// exactly why the jump is allowed to be a cheat.
//
// It arrives on a HIGH ORBIT, never on the ground. The descent is the best part of the
// game and no drive is allowed to skip it.

import { vec3, set, scale, length, normalize, cross } from '../shared/vec3.js';
import { BODIES, BODY_IDS } from '../shared/bodies.js';
import { circularSpeed } from '../shared/orbit.js';
import { SHIP } from './flight.js';

export const JUMP = {
  chargeSeconds: 14,
  transitSeconds: 6,
  cooldownSeconds: 8,
  fuelFraction: 0.14,
  arrivalRadius: 2.6,
  minimumRange: 1e9,
};

const axis = vec3();
const tangent = vec3();

export class JumpDrive {
  constructor() {
    this.state = 'idle';
    this.timer = 0;
    this.target = null;
    this.message = '';
    this.progress = 0;
  }

  get targets() {
    return BODY_IDS.filter((id) => id !== 'sun');
  }

  cycleTarget(current) {
    const list = this.targets.filter((id) => id !== current);
    if (!list.length) return;
    const index = list.indexOf(this.target);
    this.target = list[(index + 1) % list.length];
    this.message = `${BODIES[this.target].name} set`;
  }

  // Refusals are stated, never silent: a crew that presses the button and sees nothing
  // happen assumes the game is broken, not that they forgot to raise the gear.
  engage(ship) {
    if (this.state !== 'idle') return false;
    if (!this.target) {
      this.message = 'no target';
      return false;
    }
    if (this.target === ship.frame) {
      this.message = 'already there';
      return false;
    }
    if (ship.landed || ship.contact > 0) {
      this.message = 'cannot jump while landed';
      return false;
    }
    if (ship.fuel < SHIP.fuelCapacity * JUMP.fuelFraction) {
      this.message = 'not enough fuel';
      return false;
    }
    this.state = 'charging';
    this.timer = JUMP.chargeSeconds;
    this.message = `charging for ${BODIES[this.target].name}`;
    return true;
  }

  abort() {
    if (this.state === 'charging') {
      this.state = 'idle';
      this.timer = 0;
      this.message = 'charge aborted';
    }
  }

  update(dt, ship, arrive) {
    if (this.state === 'idle') {
      this.progress = 0;
      return;
    }

    this.timer -= dt;
    if (this.state === 'charging') {
      this.progress = 1 - this.timer / JUMP.chargeSeconds;
      if (this.timer <= 0) {
        ship.fuel = Math.max(0, ship.fuel - SHIP.fuelCapacity * JUMP.fuelFraction);
        this.state = 'transit';
        this.timer = JUMP.transitSeconds;
        this.message = `in transit to ${BODIES[this.target].name}`;
      }
      return;
    }

    if (this.state === 'transit') {
      this.progress = 1 - this.timer / JUMP.transitSeconds;
      if (this.timer <= 0) {
        arrive(this.target);
        this.state = 'cooldown';
        this.timer = JUMP.cooldownSeconds;
        this.message = `arrived at ${BODIES[this.target].name}`;
        this.target = null;
      }
      return;
    }

    this.progress = 0;
    if (this.timer <= 0) {
      this.state = 'idle';
      this.message = '';
    }
  }
}

// Drop the ship onto a clean circular orbit of the target, inclined a little so the
// arrival never looks like a diagram, and pointing prograde so the first thing the pilot
// sees is where they are going.
export function placeOnArrivalOrbit(ship, bodyId, seed = 0.37) {
  const body = BODIES[bodyId];
  const radius = body.radius * JUMP.arrivalRadius;
  const a = seed * Math.PI * 2;
  set(ship.position, Math.cos(a) * radius, Math.sin(a * 0.6) * radius * 0.24, Math.sin(a) * radius);
  scale(ship.position, ship.position, radius / length(ship.position));

  set(axis, 0, 1, 0);
  cross(tangent, axis, ship.position);
  normalize(tangent, tangent);
  scale(ship.velocity, tangent, circularSpeed(bodyId, radius));
  ship.frame = bodyId;
  ship.landed = false;
  ship.contact = 0;
  set(ship.angularVelocity, 0, 0, 0);
  return ship;
}
