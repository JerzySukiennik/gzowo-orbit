// Phase 1 entry point: the frame of reference from phase 0, now carrying real ground.
//
// Two clocks on purpose. The environment clock is accelerated so a sunrise fits inside
// a session; local motion runs at real seconds, because a landing flown at 100x is not
// a landing. Interplanetary travel is by jump, so the two never visibly disagree.

import { LayeredRenderer } from './core/renderer.js';
import { createStarfield } from './core/sky.js';
import { BodyViews } from './core/bodyviews.js';
import { Observer } from './core/observer.js';
import { Hud } from './core/hud.js';
import { PlanetSurface } from './world/planetsurface.js';
import { TIME_SCALE } from './shared/units.js';
import { BODIES, BODY_IDS } from './shared/bodies.js';
import { vec3, sub, add, set, distance, length, scale } from './shared/vec3.js';

const INFLUENCE = 400;
const EYE_HEIGHT = 3;

const canvas = document.getElementById('view');
const renderer = new LayeredRenderer(canvas);
renderer.starScene.add(createStarfield());

const views = new BodyViews(renderer.farScene, renderer.nearScene);
const surface = new PlanetSurface(renderer.nearScene);
const observer = new Observer(canvas);
const hud = new Hud(document.getElementById('hud'));

const origin = vec3();
const sunward = vec3();
const localDirection = vec3();
let envTime = 0;
let last = performance.now();
let groundAltitude = 0;
let terrainStats = { patches: 0, loaded: 0, inflight: 0 };

function warp(bodyId) {
  sub(sunward, views.positions.sun, views.positions[bodyId]);
  if (bodyId === 'sun') set(sunward, 0, 0, 1);
  observer.warpTo(bodyId, sunward);
}

views.updatePositions(envTime);
warp('earth');

const warpKeys = { Digit1: 'sun', Digit2: 'earth', Digit3: 'moon', Digit4: 'mars' };
window.addEventListener('keydown', (event) => {
  const target = warpKeys[event.code];
  if (target && BODY_IDS.includes(target)) warp(target);
});

window.addEventListener('resize', () => renderer.resize());
window.orbit = { observer, views, renderer, surface, warp };

function dominantFrame() {
  let best = observer.frame;
  let bestRatio = Infinity;
  for (const id of BODY_IDS) {
    const ratio = distance(origin, views.positions[id]) / (BODIES[id].radius * INFLUENCE);
    if (ratio < bestRatio) {
      bestRatio = ratio;
      best = id;
    }
  }
  return best;
}

function rebaseFrame() {
  const target = dominantFrame();
  if (target === observer.frame) return;
  sub(observer.local, origin, views.positions[target]);
  observer.frame = target;
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

function clampToGround(bodyId) {
  const body = BODIES[bodyId];
  const radius = length(observer.local);
  if (radius === 0 || radius > body.radius * 1.6) {
    groundAltitude = radius - body.radius;
    return;
  }
  scale(localDirection, observer.local, 1 / radius);
  const ground = body.radius + surface.heightAt(localDirection);
  groundAltitude = radius - ground;
  if (groundAltitude < EYE_HEIGHT) {
    scale(observer.local, localDirection, ground + EYE_HEIGHT);
    groundAltitude = EYE_HEIGHT;
  }
}

function step(dt) {
  envTime += dt * TIME_SCALE;

  observer.update(dt);
  views.updatePositions(envTime);
  add(origin, views.positions[observer.frame], observer.local);
  rebaseFrame();
  views.place(envTime, origin);

  const near = surfaceBody();
  views.suppressed = near;
  if (near) {
    add(origin, views.positions[observer.frame], observer.local);
    if (observer.frame === near) clampToGround(near);
    add(origin, views.positions[observer.frame], observer.local);
    views.place(envTime, origin);
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
    groundAltitude = 0;
  }

  renderer.render(observer.quaternion);

  hud.tick(dt);
  hud.update({ observer, views, envTime, origin, surface: near, groundAltitude, terrainStats, info: renderer.info });
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  step(dt);
  requestAnimationFrame(frame);
}

window.orbit.step = step;
requestAnimationFrame(frame);
