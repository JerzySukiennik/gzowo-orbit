// Where the work turns into something. One station in Earth orbit and one pad on the
// ground: the only two places with people, which is what makes everywhere else feel empty
// on purpose rather than by accident.

import { vec3, set, scale, sub, length, distance } from '../shared/vec3.js';
import { BODIES } from '../shared/bodies.js';
import { circularSpeed } from '../shared/orbit.js';
import { RESOURCES, RESOURCE_IDS, emptyCargo } from '../work/resources.js';
import { SHIP } from '../ship/flight.js';
import { SUIT } from '../crew/astronaut.js';

export const DOCKING = { range: 80, closingSpeed: 6, holdSeconds: 1.5 };

export const STATION = {
  id: 'harbour',
  name: 'Narew Harbour',
  body: 'earth',
  altitude: 420000,
  period: 5580,
  phase: 1.1,
  inclination: 0.34,
};

export const MODULES = [
  { id: 'tanks', name: 'Auxiliary tanks', price: 4200, detail: '+18% fuel capacity', apply: () => { SHIP.fuelCapacity *= 1.18; } },
  { id: 'engines', name: 'Uprated engines', price: 6800, detail: '+15% lift thrust', apply: () => { SHIP.liftThrust *= 1.15; } },
  { id: 'hold', name: 'Extended hold', price: 3600, detail: '+50% cargo capacity', apply: (state) => { state.cargo.capacity *= 1.5; } },
  { id: 'scrubbers', name: 'Better scrubbers', price: 2900, detail: '+50% suit oxygen', apply: () => { SUIT.oxygenSeconds *= 1.5; } },
  { id: 'shielding', name: 'Ablative shielding', price: 5400, detail: 'doubles the heat the hull takes', apply: () => { SHIP.heatingLimit *= 2; } },
  { id: 'gear', name: 'Heavy gear', price: 3100, detail: 'touchdown limit 6 to 11 m/s', apply: () => { SHIP.touchdownLimit = 11; } },
];

const position = vec3();
const relative = vec3();

export function stationPosition(time, out = position) {
  const body = BODIES[STATION.body];
  const radius = body.radius + STATION.altitude;
  const angle = STATION.phase + (2 * Math.PI * time) / STATION.period;
  const x = Math.cos(angle) * radius;
  const z = Math.sin(angle) * radius;
  return set(out, x, z * Math.sin(STATION.inclination), z * Math.cos(STATION.inclination));
}

export function stationVelocity(time, out = vec3()) {
  const body = BODIES[STATION.body];
  const radius = body.radius + STATION.altitude;
  const speed = circularSpeed(STATION.body, radius);
  const angle = STATION.phase + (2 * Math.PI * time) / STATION.period;
  const x = -Math.sin(angle) * speed;
  const z = Math.cos(angle) * speed;
  return set(out, x, z * Math.sin(STATION.inclination), z * Math.cos(STATION.inclination));
}

// Docking is a state you hold, not a button you press: close enough and slow enough for
// long enough. A crew that arrives at 40 m/s has not docked, they have arrived.
export function dockingState(ship, time, previous) {
  if (ship.frame !== STATION.body) return { docked: false, range: Infinity, closing: 0, hold: 0 };
  stationPosition(time, position);
  const range = distance(ship.position, position);
  stationVelocity(time, relative);
  sub(relative, ship.velocity, relative);
  const closing = length(relative);
  const eligible = range < DOCKING.range && closing < DOCKING.closingSpeed;
  const hold = eligible ? (previous ? previous.hold : 0) + 1 / 60 : 0;
  return { docked: hold >= DOCKING.holdSeconds, range, closing, hold, eligible };
}

export function createLedger() {
  return { credits: 1200, sold: {}, modules: [], contracts: [], completed: 0 };
}

export function refuelCost(ship) {
  return Math.round(((SHIP.fuelCapacity - ship.fuel) / 1000) * 3.4);
}

export function refuel(ledger, ship) {
  const cost = refuelCost(ship);
  if (cost <= 0) return { ok: false, reason: 'tanks are full' };
  if (ledger.credits < cost) return { ok: false, reason: 'not enough credits' };
  ledger.credits -= cost;
  ship.fuel = SHIP.fuelCapacity;
  return { ok: true, cost };
}

export function sellCargo(ledger, cargo) {
  const manifest = { ...cargo.held };
  const value = emptyCargo(cargo);
  if (value <= 0) return { ok: false, reason: 'hold is empty' };
  ledger.credits += value;
  for (const [id, amount] of Object.entries(manifest)) {
    ledger.sold[id] = (ledger.sold[id] || 0) + amount;
  }
  settleContracts(ledger, manifest);
  return { ok: true, value, manifest };
}

export function buyModule(ledger, moduleId, state) {
  if (ledger.modules.includes(moduleId)) return { ok: false, reason: 'already fitted' };
  const module = MODULES.find((m) => m.id === moduleId);
  if (!module) return { ok: false, reason: 'no such module' };
  if (ledger.credits < module.price) return { ok: false, reason: 'not enough credits' };
  ledger.credits -= module.price;
  ledger.modules.push(moduleId);
  module.apply(state);
  return { ok: true, module };
}

// Contracts are generated from the resources that actually exist on the bodies you can
// reach, so nobody is ever asked to deliver something the Solar System does not have.
export function offerContracts(ledger, seed = 1) {
  if (ledger.contracts.length >= 3) return ledger.contracts;
  while (ledger.contracts.length < 3) {
    const index = ledger.contracts.length + Math.floor(Math.abs(Math.sin(seed + ledger.completed * 3.7 + ledger.contracts.length)) * 97);
    const kind = RESOURCE_IDS[index % RESOURCE_IDS.length];
    const amount = 1200 + (index % 7) * 900;
    const reward = Math.round(((RESOURCES[kind].price * amount) / 1000) * 1.55);
    ledger.contracts.push({ id: `c${ledger.completed}-${ledger.contracts.length}`, kind, amount, delivered: 0, reward });
  }
  return ledger.contracts;
}

function settleContracts(ledger, manifest) {
  for (const contract of ledger.contracts) {
    const delivered = manifest[contract.kind] || 0;
    if (delivered <= 0) continue;
    contract.delivered += delivered;
  }
  const done = ledger.contracts.filter((contract) => contract.delivered >= contract.amount);
  for (const contract of done) {
    ledger.credits += contract.reward;
    ledger.completed += 1;
  }
  ledger.contracts = ledger.contracts.filter((contract) => contract.delivered < contract.amount);
  return done;
}
