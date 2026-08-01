// Phase 0 entry point: prove the frame of reference holds at 1:1 before anything
// prettier gets built on top of it.
//
// Two clocks on purpose. The environment clock is accelerated so a sunrise fits inside
// a session; local motion runs at real seconds, because a landing flown at 100x is not
// a landing. Interplanetary travel is by jump, so the two never visibly disagree.

import { LayeredRenderer } from './core/renderer.js';
import { createStarfield } from './core/sky.js';
import { BodyViews } from './core/bodyviews.js';
import { Observer } from './core/observer.js';
import { Hud } from './core/hud.js';
import { TIME_SCALE } from './shared/units.js';
import { BODIES, BODY_IDS } from './shared/bodies.js';
import { vec3, sub, add, set, distance } from './shared/vec3.js';

const INFLUENCE = 400;

const canvas = document.getElementById('view');
const renderer = new LayeredRenderer(canvas);
renderer.starScene.add(createStarfield());

const views = new BodyViews(renderer.farScene, renderer.nearScene);
const observer = new Observer(canvas);
const hud = new Hud(document.getElementById('hud'));

const origin = vec3();
const previousFrame = vec3();
let envTime = 0;
let last = performance.now();

const sunward = vec3();

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
window.orbit = { observer, views, renderer, warp };

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

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  envTime += dt * TIME_SCALE;

  observer.update(dt);
  views.updatePositions(envTime);
  add(origin, views.positions[observer.frame], observer.local);
  rebaseFrame();
  views.place(envTime, origin);

  renderer.render(observer.quaternion);

  hud.tick(dt);
  hud.update({ observer, views, envTime, origin, info: renderer.info });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
