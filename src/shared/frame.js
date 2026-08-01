// Floating origin and depth compression - the two rules that make 1:1 scale renderable.
//
// Rule 1: the scene frame is the world frame TRANSLATED, never rotated. World normals
// and scene normals are therefore identical, which every shader here relies on.
//
// Rule 2: the near/far decision is made on distance to the SURFACE, not to the centre.
// A body with a 6371 km radius is never "close" by centre distance, so a centre-based
// test would push a planet you are landing on into the compressed pass.
//
// Rule 3: anything further than that is pushed onto a logarithmic shell anchored at
// d0 = SURFACE_SHELL + radius and scaled by the same factor. Anchoring at d0 makes the
// transition continuous (scale is exactly 1 at the boundary), keeps ordering monotonic,
// and preserves angular size exactly, because distance and radius are scaled together.

import { vec3, sub, length } from './vec3.js';

export const SURFACE_SHELL = 1e7;
export const NEAR_FAR_PLANE = 2e9;
export const FAR_NEAR_PLANE = 1e6;
export const FAR_FAR_PLANE = 1e10;

export function placementFor(distance, radius = 0, shell = SURFACE_SHELL) {
  const anchor = shell + radius;
  if (!(distance > anchor)) return { distance, scale: 1, far: false };
  const placed = anchor * (1 + Math.log10(distance / anchor));
  return { distance: placed, scale: placed / distance, far: true };
}

const offset = vec3();

export function place(worldPosition, origin, radius, out, shell = SURFACE_SHELL) {
  sub(offset, worldPosition, origin);
  const distance = length(offset);
  if (distance === 0) {
    out.x = 0;
    out.y = 0;
    out.z = 0;
    return { distance: 0, scale: 1, far: false, trueDistance: 0 };
  }
  const placement = placementFor(distance, radius, shell);
  const k = placement.distance / distance;
  out.x = offset.x * k;
  out.y = offset.y * k;
  out.z = offset.z * k;
  placement.trueDistance = distance;
  return placement;
}
