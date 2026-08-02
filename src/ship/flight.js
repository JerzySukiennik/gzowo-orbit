// The Ranger flight model: vectored thrust that holds the ship up on nothing, wings that
// only start to matter once there is air moving past them, and real mass behind both.
//
// No three.js here on purpose - the authoritative server in phase 6 runs this file
// unchanged, and a landing has to come out the same on both ends of the wire.

import { vec3, set, copy, add, sub, scale, addScaled, dot, cross, length, normalize } from '../shared/vec3.js';
import { quat, rotateVector, integrateOrientation, fromAxisAngle, multiply, normalizeQuat } from '../shared/quat.js';
import { gravityAt, airDensity, hasAtmosphere } from '../shared/orbit.js';
import { BODIES } from '../shared/bodies.js';
import { applyStress, thrustFactor } from '../crew/rescue.js';

export const SHIP = {
  dryMass: 620000,
  fuelCapacity: 260000,
  liftThrust: 1.62e7,
  mainThrust: 9.2e6,
  exhaustVelocity: 25000,
  torque: 4.6e7,
  inertia: 1.06e9,
  angularDamping: 0.55,
  wingArea: 420,
  bodyArea: 260,
  liftSlope: 5.6,
  stallAngle: 0.28,
  dragBase: 0.05,
  inducedDrag: 0.055,
  length: 120,
  gearHeight: 11,
  gearSpring: 2.4e7,
  gearDamping: 3.1e6,
  touchdownLimit: 6,
  heatingLimit: 2.6e6,
};

export function createShip(bodyId, position, velocity) {
  return {
    frame: bodyId,
    position: copy(vec3(), position),
    velocity: copy(vec3(), velocity),
    orientation: quat(),
    angularVelocity: vec3(),
    controls: { pitch: 0, yaw: 0, roll: 0, lift: 0, main: 0, strafe: 0, vertical: 0, gear: true, brake: false },
    fuel: SHIP.fuelCapacity,
    hull: 1,
    heat: 0,
    landed: false,
    properAcceleration: vec3(),
    contact: 0,
    lastImpact: 0,
    telemetry: { altitude: 0, verticalSpeed: 0, airspeed: 0, density: 0, angleOfAttack: 0, thrust: 0, gLoad: 0 },
  };
}

const up = vec3();
const forward = vec3();
const right = vec3();
const acceleration = vec3();
const force = vec3();
const scratch = vec3();
const airflow = vec3();
const liftAxis = vec3();
const torqueAxis = vec3();
const lateral = vec3();

export function shipMass(ship) {
  // Cargo is mass like any other. A full hold is a heavier start, a longer stop and a
  // worse landing, which is the whole reason the hold has a limit.
  return SHIP.dryMass + ship.fuel + (ship.cargoMass || 0);
}

function applyAerodynamics(ship, density, mass, dt) {
  const speed = length(ship.velocity);
  if (density <= 0 || speed < 1) {
    ship.telemetry.airspeed = speed;
    ship.telemetry.angleOfAttack = 0;
    return;
  }

  normalize(airflow, ship.velocity);
  const q = 0.5 * density * speed * speed;
  const alongNose = dot(airflow, forward);
  const alongUp = dot(airflow, up);
  const angleOfAttack = Math.atan2(-alongUp, Math.max(0.05, alongNose));

  const stalled = Math.abs(angleOfAttack) > SHIP.stallAngle;
  const cl = stalled
    ? SHIP.liftSlope * Math.sign(angleOfAttack) * SHIP.stallAngle * 0.45
    : SHIP.liftSlope * angleOfAttack;
  const cd = SHIP.dragBase + SHIP.inducedDrag * cl * cl + (stalled ? 0.7 : 0);

  cross(liftAxis, right, airflow);
  normalize(liftAxis, liftAxis);
  addScaled(force, force, liftAxis, q * SHIP.wingArea * cl);
  addScaled(force, force, airflow, -q * (SHIP.bodyArea * cd + SHIP.wingArea * cd * 0.4));

  // Weathervane stability: air pushes the nose back onto the flight path, and it pushes
  // harder the faster you go. Without it the ship reenters sideways and nothing about
  // atmospheric flight feels different from vacuum.
  const restoring = q * SHIP.wingArea * 0.9;
  cross(torqueAxis, forward, airflow);
  addScaled(ship.angularVelocity, ship.angularVelocity, torqueAxis, (restoring * dt) / SHIP.inertia);

  const heating = q * speed * 1e-3;
  ship.heat = Math.max(0, ship.heat * (1 - dt * 0.35) + heating * dt);
  if (ship.heat > SHIP.heatingLimit) {
    ship.hull = Math.max(0, ship.hull - ((ship.heat - SHIP.heatingLimit) / SHIP.heatingLimit) * dt * 0.12);
  }

  ship.telemetry.airspeed = speed;
  ship.telemetry.angleOfAttack = angleOfAttack;
}

function applyGround(ship, groundAltitude, mass, dt) {
  const compression = SHIP.gearHeight - groundAltitude;
  ship.contact = 0;
  if (!ship.controls.gear || compression <= 0) {
    ship.landed = false;
    return;
  }

  normalize(scratch, ship.position);
  const verticalSpeed = dot(ship.velocity, scratch);
  const support = SHIP.gearSpring * compression - SHIP.gearDamping * Math.min(0, verticalSpeed);
  ship.contact = Math.min(1, compression / SHIP.gearHeight);
  addScaled(force, force, scratch, Math.max(0, support));

  if (verticalSpeed < -SHIP.touchdownLimit && ship.lastImpact <= 0) {
    const excess = (-verticalSpeed - SHIP.touchdownLimit) / SHIP.touchdownLimit;
    ship.hull = Math.max(0, ship.hull - Math.min(0.9, excess * 0.35));
    ship.lastImpact = 1.5;
  }

  // Friction against sliding, and a hard stop once the ship has settled. A lander that
  // creeps downhill forever is worse than one that simply parks.
  addScaled(lateral, ship.velocity, scratch, -verticalSpeed);
  const lateralSpeed = length(lateral);
  if (lateralSpeed > 0.01) {
    addScaled(force, force, lateral, (-Math.min(1, compression / 2) * mass * 2.4) / lateralSpeed);
  }
  ship.landed = Math.abs(verticalSpeed) < 1.5 && lateralSpeed < 2.5;
}

export function updateShip(ship, environment, dt) {
  const mass = shipMass(ship);
  const controls = ship.controls;

  rotateVector(up, { x: 0, y: 1, z: 0 }, ship.orientation);
  rotateVector(forward, { x: 0, y: 0, z: -1 }, ship.orientation);
  rotateVector(right, { x: 1, y: 0, z: 0 }, ship.orientation);

  set(force, 0, 0, 0);

  const liftDemand = Math.max(0, Math.min(1, controls.lift));
  const mainDemand = Math.max(0, Math.min(1, controls.main));
  const health = thrustFactor(ship);
  const liftForce = ship.fuel > 0 ? liftDemand * SHIP.liftThrust * health : 0;
  const mainForce = ship.fuel > 0 ? mainDemand * SHIP.mainThrust * health : 0;
  addScaled(force, force, up, liftForce);
  addScaled(force, force, forward, mainForce);
  addScaled(force, force, right, controls.strafe * SHIP.liftThrust * 0.06);
  addScaled(force, force, up, controls.vertical * SHIP.liftThrust * 0.06);

  const burn = ((liftForce + mainForce) / SHIP.exhaustVelocity) * dt;
  ship.fuel = Math.max(0, ship.fuel - burn);
  ship.telemetry.thrust = liftForce + mainForce;

  const altitude = environment.groundAltitude;
  const density = hasAtmosphere(ship.frame) ? airDensity(ship.frame, altitude) : 0;
  applyAerodynamics(ship, density, mass, dt);
  applyGround(ship, altitude, mass, dt);

  // What the crew actually feels is the non-gravitational force alone. Gravity is not
  // felt - that is the whole point of free fall - so this vector is what decides whether
  // someone on the deck is standing, sliding or floating.
  scale(ship.properAcceleration, force, 1 / mass);

  scale(acceleration, force, 1 / mass);
  gravityAt(ship.frame, ship.position, scratch);
  add(acceleration, acceleration, scratch);

  addScaled(ship.velocity, ship.velocity, acceleration, dt);
  addScaled(ship.position, ship.position, ship.velocity, dt);

  const authority = (SHIP.torque * dt) / SHIP.inertia;
  addScaled(ship.angularVelocity, ship.angularVelocity, right, controls.pitch * authority);
  addScaled(ship.angularVelocity, ship.angularVelocity, up, controls.yaw * authority);
  addScaled(ship.angularVelocity, ship.angularVelocity, forward, controls.roll * authority);
  const damping = controls.brake ? 3.5 : SHIP.angularDamping + (density > 0 ? density * 4 : 0);
  scale(ship.angularVelocity, ship.angularVelocity, Math.max(0, 1 - damping * dt));
  integrateOrientation(ship.orientation, ship.angularVelocity, dt);

  applyStress(ship, dt);
  if (ship.lastImpact > 0) ship.lastImpact -= dt;

  normalize(scratch, ship.position);
  ship.telemetry.altitude = altitude;
  ship.telemetry.verticalSpeed = dot(ship.velocity, scratch);
  ship.telemetry.density = density;
  ship.telemetry.gLoad = length(force) / (mass * 9.80665);
  return ship;
}
