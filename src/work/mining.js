// Cutting and drilling, and the holes both leave behind.
//
// A dig is stored as a crater on the body, not as a change to a mesh: the terrain is a
// function, so the only honest way to alter it is to alter the function. Every patch
// built afterwards - at any level of detail, on any machine - subtracts the same craters
// and comes out the same.

import { vec3, normalize, dot, length, scale, sub } from '../shared/vec3.js';
import { depositNear, addToCargo, RESOURCES } from './resources.js';

export const TOOL = {
  laserRange: 18,
  laserRate: 34,
  laserCrater: { radius: 1.6, depth: 0.55 },
  drillRate: 190,
  drillSeconds: 210,
  drillCrater: { radius: 5.5, depth: 2.4 },
  maxCratersPerBody: 512,
};

const direction = vec3();
const offset = vec3();

export function createDigSite() {
  return { craters: {}, version: 0 };
}

export function cratersFor(site, bodyId) {
  return site.craters[bodyId] || (site.craters[bodyId] = []);
}

// Craters are kept as a unit direction plus an angular radius, so they are independent of
// the level of detail that happens to be drawn and survive being saved and reloaded.
export function digCrater(site, bodyId, worldDirection, bodyRadius, shape) {
  const list = cratersFor(site, bodyId);
  normalize(direction, worldDirection);
  const angular = shape.radius / bodyRadius;

  for (const crater of list) {
    const cosine = crater.d[0] * direction.x + crater.d[1] * direction.y + crater.d[2] * direction.z;
    if (Math.acos(Math.max(-1, Math.min(1, cosine))) < angular * 0.45) {
      crater.depth = Math.min(crater.depth + shape.depth * 0.35, shape.depth * 3);
      site.version += 1;
      return crater;
    }
  }

  const crater = { d: [direction.x, direction.y, direction.z], r: angular, depth: shape.depth };
  list.push(crater);
  if (list.length > TOOL.maxCratersPerBody) list.shift();
  site.version += 1;
  return crater;
}

export function craterDepthAt(craters, direction) {
  let total = 0;
  for (let i = 0; i < craters.length; i += 1) {
    const crater = craters[i];
    const cosine = crater.d[0] * direction.x + crater.d[1] * direction.y + crater.d[2] * direction.z;
    if (cosine <= 0) continue;
    const angle = Math.acos(Math.min(1, cosine));
    if (angle >= crater.r) continue;
    const t = angle / crater.r;
    total += crater.depth * (1 - t * t) * (1 - t * t);
  }
  return total;
}

export function createDrill() {
  return { deployed: false, bodyId: null, direction: vec3(), kind: null, remaining: 0, produced: 0 };
}

// The laser takes small veins the moment you point at one; the drill takes the rich ones
// and makes you stay. That difference is the only reason a crew ever splits up.
export function fireLaser(state, dt) {
  const { bodyId, bodyRadius, aimDirection, aimDistance, cargo, site } = state;
  if (aimDistance > TOOL.laserRange) return { cutting: false, reason: 'out of range' };
  const deposit = depositNear(bodyId, aimDirection, bodyRadius);
  if (!deposit || !deposit.inRange) return { cutting: false, reason: 'no deposit here' };

  const taken = addToCargo(cargo, deposit.kind, TOOL.laserRate * dt);
  if (taken <= 0) return { cutting: false, reason: 'hold full' };
  digCrater(site, bodyId, aimDirection, bodyRadius, TOOL.laserCrater);
  return { cutting: true, kind: deposit.kind, taken };
}

export function deployDrill(drill, state) {
  const { bodyId, bodyRadius, aimDirection } = state;
  const deposit = depositNear(bodyId, aimDirection, bodyRadius);
  if (!deposit || !deposit.inRange) return { deployed: false, reason: 'no deposit here' };
  drill.deployed = true;
  drill.bodyId = bodyId;
  normalize(drill.direction, aimDirection);
  drill.kind = deposit.kind;
  drill.remaining = TOOL.drillSeconds;
  drill.produced = 0;
  digCrater(state.site, bodyId, aimDirection, bodyRadius, TOOL.drillCrater);
  return { deployed: true, kind: deposit.kind };
}

export function updateDrill(drill, cargo, dt) {
  if (!drill.deployed) return 0;
  drill.remaining -= dt;
  const produced = addToCargo(cargo, drill.kind, TOOL.drillRate * dt);
  drill.produced += produced;
  if (drill.remaining <= 0 || produced <= 0) drill.deployed = false;
  return produced;
}
