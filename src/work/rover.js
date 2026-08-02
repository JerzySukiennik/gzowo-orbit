// The rover: what turns a planet the size of Mars from a backdrop into a place you can
// cross. Four wheels on springs, each one asking the terrain how far down the ground is.
//
// Raycast wheels rather than rigid bodies on joints, the same call made in Gzowo
// Builders: a wheel with no state of its own is a wheel the solver cannot argue with.

import { vec3, set, copy, add, sub, scale, addScaled, dot, cross, length, normalize } from '../shared/vec3.js';
import { gravityAt } from '../shared/orbit.js';
import { BODIES } from '../shared/bodies.js';

export const ROVER = {
  mass: 1800,
  wheelBase: 3.2,
  track: 2.4,
  rideHeight: 0.85,
  suspension: 1.1,
  spring: 42000,
  damping: 7200,
  drive: 26000,
  brake: 16000,
  steerRate: 1.1,
  maxSteer: 0.52,
  maxSpeed: 11.5,
  rollingResistance: 0.03,
  seatHeight: 1.35,
  cargoCapacity: 6000,
};

const WHEELS = [
  { x: -1, z: -1 },
  { x: 1, z: -1 },
  { x: -1, z: 1 },
  { x: 1, z: 1 },
];

const up = vec3();
const forward = vec3();
const right = vec3();
const contact = vec3();
const wheelWorld = vec3();
const force = vec3();
const scratch = vec3();

export function createRover(bodyId, position, heading = 0) {
  return {
    frame: bodyId,
    position: copy(vec3(), position),
    velocity: vec3(),
    heading,
    steer: 0,
    wheelsDown: 0,
    speed: 0,
    occupied: false,
    cargo: { capacity: ROVER.cargoCapacity, held: {}, mass: 0 },
    deployed: true,
  };
}

// The rover's frame is rebuilt from the local up every step, exactly like the astronaut's:
// drive far enough on a sphere and any stored "north" is wrong.
function frameFor(rover) {
  normalize(up, rover.position);
  // Pick the reference axis that is least aligned with up. Always using +Y means the
  // frame collapses exactly at the poles, and a rover driven over one spins on the spot.
  const ax = Math.abs(up.x);
  const ay = Math.abs(up.y);
  const az = Math.abs(up.z);
  if (ay <= ax && ay <= az) set(scratch, 0, 1, 0);
  else if (ax <= az) set(scratch, 1, 0, 0);
  else set(scratch, 0, 0, 1);
  addScaled(scratch, scratch, up, -dot(scratch, up));
  normalize(scratch, scratch);
  cross(right, scratch, up);
  normalize(right, right);
  const cos = Math.cos(rover.heading);
  const sin = Math.sin(rover.heading);
  set(forward, 0, 0, 0);
  addScaled(forward, forward, scratch, cos);
  addScaled(forward, forward, right, sin);
  normalize(forward, forward);
  cross(right, forward, up);
  normalize(right, right);
  return { up, forward, right };
}

export function updateRover(rover, input, environment, dt) {
  const step = Math.min(0.05, dt);
  const body = BODIES[rover.frame];
  const basis = frameFor(rover);

  rover.steer += ((input.steer || 0) * ROVER.maxSteer - rover.steer) * Math.min(1, ROVER.steerRate * step * 3);
  const radius = length(rover.position);
  const groundRadius = body.radius + environment.groundHeight;

  set(force, 0, 0, 0);
  let grounded = 0;
  for (const wheel of WHEELS) {
    set(wheelWorld, 0, 0, 0);
    addScaled(wheelWorld, wheelWorld, basis.forward, (wheel.z * ROVER.wheelBase) / 2);
    addScaled(wheelWorld, wheelWorld, basis.right, (wheel.x * ROVER.track) / 2);
    add(wheelWorld, wheelWorld, rover.position);

    // Every wheel measures the ground under itself, which is what lets the rover lean on
    // a slope instead of hovering flat over it.
    const wheelRadius = length(wheelWorld);
    const localGround = groundRadius + (environment.groundHeightAt ? environment.groundHeightAt(wheelWorld) : 0);
    const compression = localGround + ROVER.rideHeight - wheelRadius;
    if (compression <= 0) continue;
    grounded += 1;
    normalize(contact, wheelWorld);
    const vertical = dot(rover.velocity, contact);
    const support = ROVER.spring * Math.min(compression, ROVER.suspension) - ROVER.damping * Math.min(0, vertical);
    addScaled(force, force, contact, Math.max(0, support) / WHEELS.length);
  }
  rover.wheelsDown = grounded;

  if (grounded > 0) {
    const traction = grounded / WHEELS.length;
    const along = dot(rover.velocity, basis.forward);
    // Thrust falls away towards a top speed instead of running to infinity: without it a
    // rover on the Moon reaches 1000 km/h, because vacuum has no wind to hold it back.
    const headroom = Math.max(0, 1 - Math.abs(along) / ROVER.maxSpeed);
    addScaled(force, force, basis.forward, (input.throttle || 0) * ROVER.drive * traction * headroom);
    const lateral = dot(rover.velocity, basis.right);
    addScaled(force, force, basis.right, -lateral * ROVER.mass * 3.2 * traction);
    addScaled(force, force, basis.forward, -along * ROVER.rollingResistance * ROVER.mass * traction);
    if (input.brake) addScaled(force, force, basis.forward, -Math.sign(along) * ROVER.brake * traction);
    rover.heading += rover.steer * Math.min(1, Math.abs(along) / 6) * step * 1.6;
  }

  scale(scratch, force, 1 / (ROVER.mass + rover.cargo.mass));
  gravityAt(rover.frame, rover.position, force);
  add(scratch, scratch, force);
  addScaled(rover.velocity, rover.velocity, scratch, step);
  addScaled(rover.position, rover.position, rover.velocity, step);

  const newRadius = length(rover.position);
  const floor = groundRadius + ROVER.rideHeight * 0.35;
  if (newRadius < floor) {
    scale(rover.position, rover.position, floor / newRadius);
    normalize(contact, rover.position);
    addScaled(rover.velocity, rover.velocity, contact, -Math.min(0, dot(rover.velocity, contact)));
  }

  rover.speed = length(rover.velocity);
  return rover;
}

export function roverEye(rover, out = vec3()) {
  const basis = frameFor(rover);
  copy(out, rover.position);
  addScaled(out, out, basis.up, ROVER.seatHeight);
  addScaled(out, out, basis.forward, 0.4);
  return out;
}

export function roverForward(rover, out = vec3()) {
  const basis = frameFor(rover);
  return copy(out, basis.forward);
}

export function roverUp(rover, out = vec3()) {
  const basis = frameFor(rover);
  return copy(out, basis.up);
}
