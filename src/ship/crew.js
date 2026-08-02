// A crew member living in ship space.
//
// The one idea this file is built on: what you feel on a deck is the ship's
// NON-gravitational acceleration, never gravity itself. In free fall the engines are off
// and you float, whatever the planet below is doing. Under thrust the deck presses into
// your feet and "down" is wherever the engines are pushing from. Landed, the gear passes
// the ground reaction up through the hull and it feels like a floor again. All three
// cases fall out of one vector, so none of them is a special case.

import { vec3, set, copy, add, addScaled, scale, sub, dot, length, normalize } from '../shared/vec3.js';
import { rotateVector } from '../shared/quat.js';
import { CREW, SEATS, resolveWalk, roomAt, inLift, LIFT, DECK } from './deck.js';

const STAND_THRESHOLD = 0.6;
const DECK_ALIGNMENT = 0.62;
const FLOAT_ACCELERATION = 5.2;
const FLOAT_DAMPING = 1.6;
const SEAT_EYE = 1.22;

const felt = vec3();
const feltDown = vec3();
const wish = vec3();
const forward = vec3();
const right = vec3();
const target = vec3();
const inverse = { x: 0, y: 0, z: 0, w: 1 };

export class Crew {
  constructor() {
    this.position = vec3(0, 0, -50);
    this.velocity = vec3();
    this.yaw = 0;
    this.pitch = 0;
    this.seat = null;
    this.mode = 'walk';
    this.grounded = false;
    this.room = null;
    this.gravity = 0;
    this.liftHeight = DECK.floor;
    this.liftTarget = DECK.floor;
  }

  get seated() {
    return this.seat !== null;
  }

  get flying() {
    return this.seat === 'pilot';
  }

  eye(out = vec3()) {
    if (this.seated) {
      const seat = SEATS.find((s) => s.id === this.seat);
      return set(out, seat.position.x, seat.position.y + SEAT_EYE, seat.position.z);
    }
    return set(out, this.position.x, this.position.y + CREW.eyeHeight, this.position.z);
  }

  look(dx, dy) {
    this.yaw -= dx;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch - dy));
  }

  nearestSeat() {
    let best = null;
    let bestDistance = 2.4;
    for (const seat of SEATS) {
      const d = Math.hypot(
        seat.position.x - this.position.x,
        seat.position.z - this.position.z
      );
      if (d < bestDistance) {
        bestDistance = d;
        best = seat;
      }
    }
    return best;
  }

  toggleSeat() {
    if (this.seated) {
      const seat = SEATS.find((s) => s.id === this.seat);
      set(this.position, seat.position.x, seat.position.y, seat.position.z + 1.5);
      set(this.velocity, 0, 0, 0);
      this.seat = null;
      return null;
    }
    const seat = this.nearestSeat();
    if (!seat) return null;
    this.seat = seat.id;
    this.yaw = seat.facing;
    this.pitch = 0;
    return seat;
  }

  callLift() {
    if (!inLift(this.position) && !this.seated) return;
    this.liftTarget = this.liftTarget === DECK.floor ? DECK.upperFloor : DECK.floor;
  }

  update(dt, ship, input) {
    const step = Math.min(0.05, dt);

    const delta = this.liftTarget - this.liftHeight;
    if (Math.abs(delta) > 1e-4) {
      this.liftHeight += Math.sign(delta) * Math.min(Math.abs(delta), LIFT.speed * step);
    }

    inverse.x = -ship.orientation.x;
    inverse.y = -ship.orientation.y;
    inverse.z = -ship.orientation.z;
    inverse.w = ship.orientation.w;
    rotateVector(felt, ship.properAcceleration, inverse);
    const magnitude = length(felt);
    this.gravity = magnitude;

    if (magnitude > STAND_THRESHOLD) {
      scale(feltDown, felt, -1 / magnitude);
    } else {
      set(feltDown, 0, 0, 0);
    }
    const standing = magnitude > STAND_THRESHOLD && -feltDown.y > DECK_ALIGNMENT;
    this.mode = this.seated ? 'seated' : standing ? 'walk' : 'float';

    if (this.seated) {
      set(this.velocity, 0, 0, 0);
      this.room = roomAt(this.position);
      return;
    }

    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    set(forward, -sy, 0, -cy);
    set(right, cy, 0, -sy);
    set(wish, 0, 0, 0);
    addScaled(wish, wish, forward, input.forward);
    addScaled(wish, wish, right, input.strafe);
    const wishLength = length(wish);
    if (wishLength > 0) scale(wish, wish, 1 / wishLength);

    if (this.mode === 'walk') {
      const speed = CREW.walkSpeed * (input.run ? 1.7 : 1);
      this.velocity.x = wish.x * speed;
      this.velocity.z = wish.z * speed;
      this.velocity.y -= Math.min(magnitude, 12) * step;
    } else {
      // Floating: the crew pushes off in the direction they are looking, and nothing
      // stops them but the walls. Damping stands in for grabbing a handhold.
      const cp = Math.cos(this.pitch);
      set(forward, -sy * cp, Math.sin(this.pitch), -cy * cp);
      addScaled(this.velocity, this.velocity, forward, input.forward * FLOAT_ACCELERATION * step);
      addScaled(this.velocity, this.velocity, right, input.strafe * FLOAT_ACCELERATION * step);
      this.velocity.y += input.vertical * FLOAT_ACCELERATION * step;
      addScaled(this.velocity, this.velocity, felt, step);
      scale(this.velocity, this.velocity, Math.max(0, 1 - FLOAT_DAMPING * step));
    }

    addScaled(target, this.position, this.velocity, step);
    const resolved = resolveWalk(this.position, target, this.liftHeight);
    if (resolved.x === this.position.x && target.x !== this.position.x) this.velocity.x = 0;
    if (resolved.z === this.position.z && target.z !== this.position.z) this.velocity.z = 0;
    if (resolved.y !== target.y) this.velocity.y = 0;
    set(this.position, resolved.x, resolved.y, resolved.z);
    this.grounded = resolved.grounded;
    this.room = resolved.room;
    if (this.grounded && inLift(this.position)) this.position.y = this.liftHeight;
  }
}
