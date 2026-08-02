// Newtonian gravity, orbital elements and air. Pure float64, no three.js - the flight
// model, the HUD and the phase 6 server all read the same numbers from here.
//
// Everything is expressed in the reference frame of one body: position and velocity are
// relative to its centre, which is what an orbit actually is.

import { vec3, scale, length, lengthSq, dot, cross, sub } from './vec3.js';
import { BODIES } from './bodies.js';

const AIR = {
  earth: { density: 1.225, scaleHeight: 8500, ceiling: 140000 },
  mars: { density: 0.02, scaleHeight: 11100, ceiling: 90000 },
};

export function gravityAt(bodyId, position, out = vec3()) {
  const body = BODIES[bodyId];
  const r = length(position);
  if (r === 0) return scale(out, position, 0);
  const factor = -body.mu / (r * r * r);
  return scale(out, position, factor);
}

export function airDensity(bodyId, altitude) {
  const air = AIR[bodyId];
  if (!air || altitude > air.ceiling || altitude < -1000) return 0;
  return air.density * Math.exp(-Math.max(0, altitude) / air.scaleHeight);
}

export function hasAtmosphere(bodyId) {
  return Boolean(AIR[bodyId]);
}

const angularMomentum = vec3();
const eccentricityVector = vec3();
const term = vec3();

// Classical elements from state vectors. Used by the navigation display, so it has to
// stay honest on hyperbolic paths too - a crew that burns too hard needs to see the
// orbit open up, not a nonsense apoapsis.
export function elements(bodyId, position, velocity) {
  const mu = BODIES[bodyId].mu;
  const r = length(position);
  const v = length(velocity);
  const energy = (v * v) / 2 - mu / r;
  const semiMajor = energy === 0 ? Infinity : -mu / (2 * energy);

  cross(angularMomentum, position, velocity);
  const h = length(angularMomentum);

  scale(eccentricityVector, position, v * v - mu / r);
  scale(term, velocity, dot(position, velocity));
  sub(eccentricityVector, eccentricityVector, term);
  scale(eccentricityVector, eccentricityVector, 1 / mu);
  const e = length(eccentricityVector);

  const closed = e < 1 && Number.isFinite(semiMajor) && semiMajor > 0;
  const radius = BODIES[bodyId].radius;
  return {
    speed: v,
    radius: r,
    altitude: r - radius,
    eccentricity: e,
    semiMajor,
    apoapsis: closed ? semiMajor * (1 + e) - radius : Infinity,
    periapsis: closed ? semiMajor * (1 - e) - radius : semiMajor * (1 - e) - radius,
    period: closed ? 2 * Math.PI * Math.sqrt((semiMajor * semiMajor * semiMajor) / mu) : Infinity,
    inclination: h === 0 ? 0 : Math.acos(Math.max(-1, Math.min(1, angularMomentum.y / h))),
    closed,
    verticalSpeed: dot(position, velocity) / r,
  };
}

export function circularSpeed(bodyId, radius) {
  return Math.sqrt(BODIES[bodyId].mu / radius);
}

export function escapeSpeed(bodyId, radius) {
  return Math.sqrt((2 * BODIES[bodyId].mu) / radius);
}
