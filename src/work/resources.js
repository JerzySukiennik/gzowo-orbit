// What is worth going down for, and what it costs to carry.
//
// Deposits are not stored anywhere: they are a function of position, like the terrain, so
// every crew member on every machine finds the same ore in the same crater without a byte
// crossing the wire.

import { valueNoise, fbm } from '../shared/noise.js';

export const RESOURCES = {
  ice: { name: 'Water ice', density: 917, price: 9, colour: 0x9fd4e8 },
  regolith: { name: 'Regolith', density: 1500, price: 4, colour: 0x8a8074 },
  iron: { name: 'Iron ore', density: 5200, price: 26, colour: 0x8c5a44 },
  rare: { name: 'Rare metals', density: 8900, price: 140, colour: 0xd9c27a },
  helium3: { name: 'Helium-3', density: 200, price: 620, colour: 0xc0a6ff },
};

export const RESOURCE_IDS = Object.keys(RESOURCES);

const BODY_BIAS = {
  moon: { helium3: 2.4, regolith: 1.4, ice: 0.7, iron: 0.8, rare: 0.6 },
  mars: { iron: 1.9, ice: 1.2, regolith: 1.2, rare: 0.9, helium3: 0.2 },
  earth: { iron: 1.0, regolith: 1.0, ice: 1.0, rare: 0.5, helium3: 0.05 },
};

// Sized so a deposit is findable on foot once the suit points at it, and rare enough
// that the pointing matters: at 900 m apart with a 26 m mouth they covered 0.08% of the
// surface and nobody would ever have stood on one by accident.
export const DEPOSIT = { spacing: 520, radius: 70, richness: 2600 };

// One deposit per cell of a coarse grid laid over the surface, jittered inside its cell.
// Deterministic from the cell index, so it is the same for everyone, forever, with no
// storage and no synchronisation.
function depositInCell(bodyId, cell, scale) {
  const seed = cell[0] * 7919 + cell[1] * 104729 + cell[2] * 1299709;
  const presence = valueNoise(cell[0] * 0.7, cell[1] * 0.7, cell[2] * 0.7) * 0.5 + 0.5;
  if (presence < 0.42) return null;

  const bias = BODY_BIAS[bodyId] || BODY_BIAS.earth;
  const roll = (Math.abs(Math.sin(seed)) * 1000) % 1;
  let total = 0;
  for (const id of RESOURCE_IDS) total += bias[id] || 0;
  let cursor = roll * total;
  let kind = RESOURCE_IDS[0];
  for (const id of RESOURCE_IDS) {
    cursor -= bias[id] || 0;
    if (cursor <= 0) {
      kind = id;
      break;
    }
  }

  const centre = {
    x: cell[0] * scale + valueNoise(seed * 0.13, 0, 0) * 0.4 * scale,
    y: cell[1] * scale + valueNoise(0, seed * 0.13, 0) * 0.4 * scale,
    z: cell[2] * scale + valueNoise(0, 0, seed * 0.13) * 0.4 * scale,
  };
  const length = Math.hypot(centre.x, centre.y, centre.z) || 1;
  centre.x /= length;
  centre.y /= length;
  centre.z /= length;
  return { kind, centre, richness: DEPOSIT.richness * (0.5 + presence) };
}

// The neighbourhood, not just the cell you are standing in. A deposit is jittered inside
// its own cell, so standing exactly on one can put you in the cell next door - and asking
// only your own cell answered "no deposit here" while the ore was under your boots.
export function depositNear(bodyId, direction, radius) {
  const scale = DEPOSIT.spacing / radius;
  const base = [
    Math.round(direction.x / scale),
    Math.round(direction.y / scale),
    Math.round(direction.z / scale),
  ];

  let best = null;
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const found = depositInCell(bodyId, [base[0] + dx, base[1] + dy, base[2] + dz], scale);
        if (!found) continue;
        const cosine = found.centre.x * direction.x + found.centre.y * direction.y + found.centre.z * direction.z;
        const surfaceDistance = Math.acos(Math.max(-1, Math.min(1, cosine))) * radius;
        if (!best || surfaceDistance < best.distance) {
          best = {
            kind: found.kind,
            centre: found.centre,
            richness: found.richness,
            distance: surfaceDistance,
            radius: DEPOSIT.radius,
            inRange: surfaceDistance < DEPOSIT.radius,
          };
        }
      }
    }
  }
  return best;
}

export function createCargo(capacity = 40000) {
  return { capacity, held: {}, mass: 0 };
}

export function cargoMass(cargo) {
  let total = 0;
  for (const [id, amount] of Object.entries(cargo.held)) total += amount;
  return total;
}

export function addToCargo(cargo, kind, kilograms) {
  const room = cargo.capacity - cargoMass(cargo);
  const taken = Math.max(0, Math.min(room, kilograms));
  if (taken <= 0) return 0;
  cargo.held[kind] = (cargo.held[kind] || 0) + taken;
  cargo.mass = cargoMass(cargo);
  return taken;
}

export function emptyCargo(cargo) {
  let value = 0;
  for (const [id, amount] of Object.entries(cargo.held)) value += (RESOURCES[id].price * amount) / 1000;
  cargo.held = {};
  cargo.mass = 0;
  return Math.round(value);
}
