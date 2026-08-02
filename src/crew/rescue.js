// Failure, repair and getting someone back.
//
// Nothing here breaks at random. Every failure has a cause the crew can point at and,
// usually, could have avoided - a landing flown too fast, an entry flown too steep, a
// reactor held past its rating. A random failure teaches nobody anything.

import { SHIP } from '../ship/flight.js';
import { SUIT } from './astronaut.js';
import { RESOURCES } from '../work/resources.js';

export const SYSTEMS = {
  reactor: { name: 'Reactor', repairSeconds: 90, effect: 'thrust and power' },
  engines: { name: 'Engines', repairSeconds: 70, effect: 'lift and main thrust' },
  life: { name: 'Life support', repairSeconds: 55, effect: 'cabin oxygen' },
  gear: { name: 'Landing gear', repairSeconds: 45, effect: 'touchdown limit' },
};

export const SYSTEM_IDS = Object.keys(SYSTEMS);

export function createSystems() {
  const state = {};
  for (const id of SYSTEM_IDS) state[id] = 1;
  return state;
}

export function healthOf(ship) {
  if (!ship.systems) ship.systems = createSystems();
  return ship.systems;
}

// Wear is applied where the cause was, not spread over a single hull number: a hard
// landing hurts the gear, a hot entry hurts the reactor's cooling, holding full thrust
// hurts the engines. The crew can then repair the thing they broke.
export function applyStress(ship, dt) {
  const systems = healthOf(ship);

  if (ship.lastImpact > 0 && ship.lastImpact > 1.49) {
    systems.gear = Math.max(0, systems.gear - 0.35);
  }
  if (ship.heat > SHIP.heatingLimit * 0.85) {
    systems.reactor = Math.max(0, systems.reactor - dt * 0.05);
  }
  const demand = ship.controls.lift + ship.controls.main;
  if (demand > 1.55) {
    systems.engines = Math.max(0, systems.engines - (demand - 1.55) * dt * 0.05);
  }
  if (ship.hull < 0.5) {
    systems.life = Math.max(0, systems.life - dt * 0.01);
  }
  return systems;
}

export function thrustFactor(ship) {
  const systems = healthOf(ship);
  return Math.max(0.15, 0.35 + 0.65 * Math.min(systems.engines, systems.reactor));
}

export function repair(ship, systemId, dt) {
  const systems = healthOf(ship);
  if (systems[systemId] >= 1) return { done: true, progress: 1 };
  systems[systemId] = Math.min(1, systems[systemId] + dt / SYSTEMS[systemId].repairSeconds);
  return { done: systems[systemId] >= 1, progress: systems[systemId] };
}

export function worstSystem(ship) {
  const systems = healthOf(ship);
  let worst = null;
  for (const id of SYSTEM_IDS) {
    if (!worst || systems[id] < systems[worst]) worst = id;
  }
  return systems[worst] < 1 ? worst : null;
}

export const RESCUE = { window: 60, cargoLoss: 0.5 };

// A crew member who goes down has a window in which someone can reach them, and after
// that the beacon fires: they wake in the medbay, and half the hold is the price. Losing
// the session would be a worse game than losing the cargo.
export function rescueState(astronaut) {
  if (!astronaut || !astronaut.down) return { down: false, remaining: 0 };
  if (astronaut.rescueTimer === undefined) astronaut.rescueTimer = RESCUE.window;
  return { down: true, remaining: Math.max(0, astronaut.rescueTimer) };
}

export function tickRescue(astronaut, dt) {
  if (!astronaut || !astronaut.down) return false;
  if (astronaut.rescueTimer === undefined) astronaut.rescueTimer = RESCUE.window;
  astronaut.rescueTimer -= dt;
  return astronaut.rescueTimer <= 0;
}

export function assist(astronaut) {
  if (!astronaut || !astronaut.down) return false;
  astronaut.down = false;
  astronaut.oxygen = SUIT.oxygenSeconds * 0.5;
  astronaut.health = Math.max(astronaut.health, 0.6);
  astronaut.rescueTimer = undefined;
  return true;
}

export function beacon(cargo) {
  const lost = {};
  for (const [id, amount] of Object.entries(cargo.held)) {
    const drop = amount * RESCUE.cargoLoss;
    lost[id] = drop;
    cargo.held[id] = amount - drop;
    if (cargo.held[id] < 1) delete cargo.held[id];
  }
  let mass = 0;
  for (const amount of Object.values(cargo.held)) mass += amount;
  cargo.mass = mass;
  const value = Object.entries(lost).reduce((sum, [id, amount]) => sum + (RESOURCES[id].price * amount) / 1000, 0);
  return { lost, value: Math.round(value) };
}
