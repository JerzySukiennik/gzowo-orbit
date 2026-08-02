// The Solar System at 1:1. Real radii, real orbital distances, real rotation periods.
// Phase 0 uses circular inclined orbits; phase 2 replaces positionAt() with proper
// Kepler elements. Everything else in the game reads bodies through this module only.

import { vec3, set } from './vec3.js';
import { AU, G, DAY, HOUR, DEG } from './units.js';

export const BODIES = {
  sun: {
    id: 'sun',
    name: 'Sun',
    radius: 695700000,
    mass: 1.98892e30,
    rotationPeriod: 25.05 * DAY,
    axialTilt: 7.25 * DEG,
    colour: 0xfff2d8,
    emissive: true,
    parent: null,
  },
  earth: {
    id: 'earth',
    name: 'Earth',
    radius: 6371000,
    mass: 5.97219e24,
    rotationPeriod: 23.9345 * HOUR,
    axialTilt: 23.44 * DEG,
    colour: 0x2b5d8c,
    atmosphere: { height: 100000, colour: 0x6ba3e0 },
    parent: 'sun',
    orbit: { radius: 1.0 * AU, period: 365.256 * DAY, inclination: 0, node: 0, phase: 0 },
  },
  moon: {
    id: 'moon',
    name: 'Moon',
    radius: 1737400,
    mass: 7.342e22,
    rotationPeriod: 27.321661 * DAY,
    axialTilt: 6.68 * DEG,
    colour: 0x9a9691,
    parent: 'earth',
    orbit: {
      radius: 384400000,
      period: 27.321661 * DAY,
      inclination: 5.145 * DEG,
      node: 125.08 * DEG,
      phase: 1.2,
    },
  },
  mars: {
    id: 'mars',
    name: 'Mars',
    radius: 3389500,
    mass: 6.4171e23,
    rotationPeriod: 24.6229 * HOUR,
    axialTilt: 25.19 * DEG,
    colour: 0xa8583a,
    atmosphere: { height: 60000, colour: 0xd8a678 },
    parent: 'sun',
    orbit: { radius: 1.523679 * AU, period: 686.98 * DAY, inclination: 1.85 * DEG, node: 49.56 * DEG, phase: 2.4 },
  },
};

export const BODY_IDS = Object.keys(BODIES);

for (const body of Object.values(BODIES)) {
  body.mu = G * body.mass;
  body.surfaceGravity = body.mu / (body.radius * body.radius);
}

const scratch = [vec3(), vec3(), vec3(), vec3()];

export function positionAt(bodyId, time, out = vec3(), depth = 0) {
  const body = BODIES[bodyId];
  set(out, 0, 0, 0);
  if (!body.orbit) return out;

  const { radius, period, inclination, node, phase } = body.orbit;
  const angle = phase + (2 * Math.PI * time) / period;
  const x = radius * Math.cos(angle);
  const z = radius * Math.sin(angle);
  const y = z * Math.sin(inclination);
  const zi = z * Math.cos(inclination);

  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);
  set(out, x * cosNode - zi * sinNode, y, x * sinNode + zi * cosNode);

  if (body.parent) {
    const parent = positionAt(body.parent, time, scratch[depth], depth + 1);
    out.x += parent.x;
    out.y += parent.y;
    out.z += parent.z;
  }
  return out;
}

const before = vec3();
const after = vec3();

// Body velocity by central difference. Needed whenever a ship changes reference frame:
// hand it the same position in a new frame without the frame's own motion and it will
// appear to have gained kilometres per second it never burned for.
export function velocityAt(bodyId, time, out = vec3(), h = 1) {
  positionAt(bodyId, time - h, before);
  positionAt(bodyId, time + h, after);
  out.x = (after.x - before.x) / (2 * h);
  out.y = (after.y - before.y) / (2 * h);
  out.z = (after.z - before.z) / (2 * h);
  return out;
}

export function rotationAt(bodyId, time) {
  const body = BODIES[bodyId];
  if (!body.rotationPeriod) return 0;
  return (2 * Math.PI * time) / body.rotationPeriod;
}

export function orbitalSpeed(bodyId, altitude = 0) {
  const body = BODIES[bodyId];
  return Math.sqrt(body.mu / (body.radius + altitude));
}
