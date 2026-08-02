// Procedural relief per body, in metres above the reference sphere.
//
// Earth uses this only as detail below the resolution of the real data, and as the
// fallback when a tile is missing - a stream that goes quiet must leave terrain, not a
// hole. The Moon and Mars are procedural all the way down.

import { fbm, ridged, valueNoise, craterField } from './noise.js';

export const SURFACE_PROFILE = {
  earth: { seaLevel: 0, detailAmplitude: 22, detailFrequency: 26000 },
  moon: { seaLevel: 0, detailAmplitude: 9, detailFrequency: 42000 },
  mars: { seaLevel: 0, detailAmplitude: 16, detailFrequency: 30000 },
};

// Real relief, not dramatic relief. The lunar maria sit 2-3 km below the highlands and
// even Mare Orientale is nowhere near 20 km deep; an unchecked crater depth scaled by a
// 270 km basin radius produced exactly that, and dropped an astronaut into a hole the
// size of a mountain range.
function moonHeight(d) {
  const maria = fbm(d.x * 1.7 + 11, d.y * 1.7, d.z * 1.7, 4);
  const lowland = Math.min(0, maria + 0.18) * 0.0016;
  const rough = fbm(d.x * 9 + 3, d.y * 9, d.z * 9, 6) * 0.0006;
  const craters =
    craterField(d.x, d.y, d.z, 0.31, 0.012) +
    craterField(d.x * 1.31 + 5, d.y * 1.31, d.z * 1.31, 0.085, 0.05) +
    craterField(d.x * 2.7 + 17, d.y * 2.7, d.z * 2.7, 0.021, 0.12);
  return lowland + rough + craters;
}

function marsHeight(d) {
  const dichotomy = Math.tanh((d.y * 0.55 + d.x * 0.42 + 0.15) * 2.2) * 0.00085;
  const continents = fbm(d.x * 2.1 + 7, d.y * 2.1, d.z * 2.1, 5) * 0.0011;
  const highlands = ridged(d.x * 5.5, d.y * 5.5, d.z * 5.5 + 4, 6) * 0.00075;
  const canyon = Math.max(0, 1 - Math.abs(ridged(d.x * 3.1, d.y * 3.1 + 9, d.z * 3.1, 3)) * 6);
  const volcano = Math.pow(Math.max(0, valueNoise(d.x * 2.6 + 31, d.y * 2.6, d.z * 2.6)), 7) * 0.0055;
  const craters = craterField(d.x * 1.6 + 23, d.y * 1.6, d.z * 1.6, 0.06, 0.11) * 0.55;
  return dichotomy + continents + highlands - canyon * 0.0016 + volcano + craters;
}

function earthHeight(d) {
  const continents = fbm(d.x * 1.6 + 19, d.y * 1.6, d.z * 1.6, 5);
  const land = Math.max(0, continents + 0.05);
  const mountains = ridged(d.x * 6.2, d.y * 6.2, d.z * 6.2 + 13, 6) * 0.5 + 0.5;
  return (land * 0.00055 + land * mountains * 0.0009 - Math.max(0, -continents) * 0.0006) * 1.0;
}

export function proceduralHeight(bodyId, direction, radius) {
  if (bodyId === 'moon') return moonHeight(direction) * radius;
  if (bodyId === 'mars') return marsHeight(direction) * radius;
  if (bodyId === 'earth') return earthHeight(direction) * radius;
  return 0;
}

export function detailHeight(bodyId, direction) {
  const profile = SURFACE_PROFILE[bodyId];
  if (!profile) return 0;
  const f = profile.detailFrequency;
  return fbm(direction.x * f, direction.y * f, direction.z * f, 3) * profile.detailAmplitude;
}
