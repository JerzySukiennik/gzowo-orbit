// Phase 2 entry point: the frame of reference from phase 0, the ground from phase 1, and
// a ship that has to be flown down onto it by hand.
//
// Two clocks on purpose. The environment clock is accelerated so a sunrise fits inside
// a session; the ship runs at real seconds, because a landing flown at 100x is not a
// landing. Interplanetary travel is by jump, so the two never visibly disagree.

import { LayeredRenderer } from './core/renderer.js';
import { createStarfield } from './core/sky.js';
import { BodyViews } from './core/bodyviews.js';
import { Observer } from './core/observer.js';
import { Hud } from './core/hud.js';
import { PlanetSurface } from './world/planetsurface.js';
import { ShipView, COCKPIT, CHASE } from './ship/shipview.js';
import { Pilot } from './ship/pilot.js';
import { Cockpit } from './ship/cockpit.js';
import { Crew } from './ship/crew.js';
import { SEATS } from './ship/deck.js';
import { createAstronaut, updateAstronaut, localFrame, lookDirection, refill, needsSuit, SUIT } from './crew/astronaut.js';
import { Visor } from './crew/visor.js';
import { rotateVector } from './shared/quat.js';
import { createShip, updateShip, SHIP } from './ship/flight.js';
import { circularSpeed } from './shared/orbit.js';
import { TIME_SCALE } from './shared/units.js';
import { BODIES, BODY_IDS, velocityAt } from './shared/bodies.js';
import { vec3, sub, add, set, copy, scale, addScaled, distance, length } from './shared/vec3.js';

const INFLUENCE = 400;

const canvas = document.getElementById('view');
const renderer = new LayeredRenderer(canvas);
renderer.starScene.add(createStarfield());

const views = new BodyViews(renderer.farScene, renderer.nearScene);
const surface = new PlanetSurface(renderer.nearScene);
const shipView = new ShipView(renderer.nearScene);
const pilot = new Pilot(canvas);
const crew = new Crew();
const pilotSeat = SEATS.find((seat) => seat.id === 'pilot');
const cockpit = new Cockpit(shipView.group, {
  x: pilotSeat.position.x,
  y: pilotSeat.position.y + 1.62,
  z: pilotSeat.position.z - 0.05,
});
const observer = new Observer(canvas);
const visor = new Visor(renderer.nearScene);
const hud = new Hud(document.getElementById('hud'));

const AIRLOCK_LOCAL = { x: 10.5, y: 0, z: -3 };
let outside = null;
const outsideEye = vec3();
const lookVector = vec3();
const anchorWorld = vec3();

const origin = vec3();
const sunward = vec3();
const groundDirection = vec3();
const frameVelocity = vec3();
const nextFrameVelocity = vec3();
const shipWorld = vec3();
const eyeLocal = vec3();
const IDLE_INPUT = { forward: 0, strafe: 0, vertical: 0, run: false };

let envTime = 0;
let last = performance.now();
let freeCamera = false;
let terrainStats = { patches: 0, loaded: 0, inflight: 0 };

views.updatePositions(envTime);

// Start in a low circular orbit rather than on a pad: everything phase 2 added - orbits,
// atmosphere, gear, the manual descent - is one burn away from there.
const startRadius = BODIES.earth.radius + 380000;
const startSpeed = circularSpeed('earth', startRadius);
const ship = createShip(
  'earth',
  vec3(startRadius * 0.32, startRadius * 0.79, startRadius * 0.52),
  vec3(0, 0, 0)
);
{
  const r = length(ship.position);
  scale(ship.position, ship.position, startRadius / r);
  set(ship.velocity, -ship.position.z, 0, ship.position.x);
  scale(ship.velocity, ship.velocity, startSpeed / length(ship.velocity));
}

crew.seat = 'pilot';
crew.yaw = pilotSeat.facing;

function warpObserver(bodyId) {
  sub(sunward, views.positions.sun, views.positions[bodyId]);
  if (bodyId === 'sun') set(sunward, 0, 0, 1);
  observer.warpTo(bodyId, sunward);
}
warpObserver('earth');

const warpKeys = { Digit1: 'sun', Digit2: 'earth', Digit3: 'moon', Digit4: 'mars' };
window.addEventListener('keydown', (event) => {
  if (event.code === 'KeyC') freeCamera = !freeCamera;
  if (event.code === 'KeyG') pilot.toggleGear();
  if (event.code === 'KeyE' && !outside) crew.toggleSeat();
  if (event.code === 'KeyL' && !outside) crew.callLift();
  if (event.code === 'KeyO') toggleAirlock();
  const target = warpKeys[event.code];
  if (target && BODY_IDS.includes(target) && freeCamera) warpObserver(target);
});

window.addEventListener('resize', () => renderer.resize());
window.orbit = {
  ship, shipView, pilot, crew, observer, views, renderer, surface, cockpit, visor,
  toggleAirlock,
  get outside() {
    return outside;
  },
};

// The airlock is the only way in or out, and it is a place on the hull rather than a
// menu: stepping out puts the astronaut exactly where that door is, moving at whatever
// the ship was moving at.
function toggleAirlock() {
  if (outside) {
    add(shipWorld, views.positions[ship.frame], ship.position);
    add(anchorWorld, views.positions[outside.frame], outside.position);
    if (distance(shipWorld, anchorWorld) > 140) return;
    refill(outside);
    outside = null;
    crew.seat = null;
    set(crew.position, AIRLOCK_LOCAL.x - 4, 0, AIRLOCK_LOCAL.z);
    return;
  }
  if (crew.seated) return;
  rotateVector(lookVector, AIRLOCK_LOCAL, ship.orientation);
  add(outsideEye, ship.position, lookVector);
  outside = createAstronaut(ship.frame, outsideEye);
  copy(outside.velocity, ship.velocity);
  outside.mode = ship.landed ? 'surface' : 'eva';
  outside.tethered = outside.mode === 'eva';
  outside.yaw = 0;
}

function dominantBody(position) {
  let best = null;
  let bestRatio = Infinity;
  for (const id of BODY_IDS) {
    const ratio = distance(position, views.positions[id]) / (BODIES[id].radius * INFLUENCE);
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = id;
    }
  }
  return best;
}

// Changing reference frame has to carry the velocity difference of the two bodies, or a
// ship drifting from the Moon to the Earth silently gains a kilometre per second.
function rebaseShip(target) {
  if (target === ship.frame) return;
  velocityAt(ship.frame, envTime, frameVelocity);
  velocityAt(target, envTime, nextFrameVelocity);
  add(ship.position, ship.position, views.positions[ship.frame]);
  sub(ship.position, ship.position, views.positions[target]);
  add(ship.velocity, ship.velocity, frameVelocity);
  sub(ship.velocity, ship.velocity, nextFrameVelocity);
  ship.frame = target;
}

function astronautGroundHeight() {
  if (!outside || surface.bodyId !== outside.frame) return 0;
  const radius = length(outside.position);
  if (radius === 0) return 0;
  scale(groundDirection, outside.position, 1 / radius);
  return surface.heightAt(groundDirection);
}

function groundAltitude() {
  const radius = length(ship.position);
  const body = BODIES[ship.frame];
  if (radius === 0) return 0;
  if (surface.bodyId !== ship.frame) return radius - body.radius;
  scale(groundDirection, ship.position, 1 / radius);
  return radius - (body.radius + surface.heightAt(groundDirection));
}

function step(dt) {
  envTime += dt * TIME_SCALE;

  const mouse = pilot.takeMouse();
  if (outside) {
    outside.yaw -= mouse.dx;
    outside.pitch = Math.max(-1.45, Math.min(1.45, outside.pitch - mouse.dy));
  } else if (crew.flying) {
    Object.assign(ship.controls, pilot.sample(dt, mouse));
  } else {
    crew.look(mouse.dx, mouse.dy);
    // Throttles stay where the pilot left them; nobody is at the stick to steer.
    ship.controls.pitch = 0;
    ship.controls.yaw = 0;
    ship.controls.roll = 0;
    ship.controls.strafe = 0;
    ship.controls.vertical = 0;
  }
  updateShip(ship, { groundAltitude: groundAltitude() }, dt);
  if (outside) {
    const walk = pilot.walkInput();
    add(anchorWorld, views.positions[ship.frame], ship.position);
    sub(anchorWorld, anchorWorld, views.positions[outside.frame]);
    updateAstronaut(
      outside,
      { forward: walk.forward, strafe: walk.strafe, vertical: walk.vertical, run: walk.run, jump: pilot.held('Space') },
      {
        groundHeight: astronautGroundHeight(),
        anchor: outside.tethered ? anchorWorld : null,
        anchorVelocity: outside.frame === ship.frame ? ship.velocity : null,
      },
      dt
    );
  } else {
    crew.update(dt, ship, crew.flying ? IDLE_INPUT : pilot.walkInput());
  }

  views.updatePositions(envTime);
  add(shipWorld, views.positions[ship.frame], ship.position);
  rebaseShip(dominantBody(shipWorld));

  if (freeCamera) {
    observer.update(dt);
    add(origin, views.positions[observer.frame], observer.local);
  } else if (outside) {
    const frame = localFrame(outside.position);
    add(origin, views.positions[outside.frame], outside.position);
    addScaled(origin, origin, frame.up, SUIT.eyeHeight);
  } else {
    crew.eye(eyeLocal);
    shipView.cameraOrigin(ship, views.positions[ship.frame], pilot.third ? CHASE : eyeLocal, origin);
  }

  views.place(envTime, origin);
  const near = surfaceBody();
  views.suppressed = near;
  if (near) {
    terrainStats = surface.update(
      near,
      views.positions[near],
      views.quaternionOf(near),
      origin,
      views.sunDirectionOf(near)
    );
  } else {
    surface.detach();
    terrainStats = { patches: 0, loaded: 0, inflight: 0 };
  }

  let orientation;
  if (freeCamera) orientation = observer.quaternion;
  else if (outside) {
    lookDirection(outside, lookVector);
    orientation = pilot.lookOrientation(lookVector, localFrame(outside.position).up);
  } else if (crew.flying) orientation = pilot.cameraOrientation(ship.orientation);
  else orientation = pilot.crewOrientation(ship.orientation, crew.yaw, crew.pitch);

  shipView.update(
    ship,
    origin,
    views.positions[ship.frame],
    ship.controls.main * 0.5 + ship.controls.lift * 0.5,
    views.sunDirectionOf(ship.frame)
  );
  const inCockpit = !freeCamera && !pilot.third && crew.flying && !outside;
  cockpit.visible = inCockpit;
  if (inCockpit) cockpit.draw(ship, ship.frame);

  const inSuit = Boolean(outside) && !freeCamera && needsSuit(outside.frame, outside.altitude);
  visor.visible = inSuit;
  if (inSuit) {
    visor.place(orientation);
    visor.draw(outside, { tether: length(anchorWorld) > 0 ? distance(outside.position, anchorWorld) : 0 });
  }

  renderer.render(orientation);

  hud.tick(dt);
  hud.update({
    observer: freeCamera ? observer : { local: ship.position, frame: ship.frame, cruiseSpeed: 0, speed: length(ship.velocity) },
    views,
    envTime,
    origin,
    surface: near,
    groundAltitude: ship.telemetry.altitude,
    terrainStats,
    ship,
    crew,
    outside,
    freeCamera,
    info: renderer.info,
  });
}

function surfaceBody() {
  let closest = null;
  let closestDistance = Infinity;
  for (const id of BODY_IDS) {
    if (id === 'sun') continue;
    const placement = views.placements[id];
    if (placement.far) continue;
    if (placement.surfaceDistance < closestDistance) {
      closestDistance = placement.surfaceDistance;
      closest = id;
    }
  }
  return closest;
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  step(dt);
  requestAnimationFrame(frame);
}

window.orbit.step = step;
requestAnimationFrame(frame);
