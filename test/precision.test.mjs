// Phase 0 acceptance test: a ship parked 1 AU from the system centre must hold its
// position to the centimetre for 10 000 frames, and the render placement must preserve
// angular size while keeping depth order. Run with: npm test

import { vec3, addScaled, distance, length, sub } from '../src/shared/vec3.js';
import { placementFor, place, SURFACE_SHELL, NEAR_FAR_PLANE, FAR_FAR_PLANE } from '../src/shared/frame.js';
import { positionAt, BODY_IDS, BODIES } from '../src/shared/bodies.js';
import { AU } from '../src/shared/units.js';

let failures = 0;

function check(name, ok, detail) {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures += 1;
  console.log(`  [${mark}] ${name}${detail ? ` - ${detail}` : ''}`);
}

function heading(text) {
  console.log(`\n${text}`);
}

const FRAMES = 10000;
const DT = 1 / 60;
const SPEED = 1000;

heading('1. Ship at 1 AU, 10 000 frames of integration');
{
  const start = vec3(AU, 0, 0);
  const velocity = vec3(0, 0, SPEED);

  const f64 = vec3(start.x, start.y, start.z);
  for (let i = 0; i < FRAMES; i += 1) addScaled(f64, f64, velocity, DT);

  let f32x = Math.fround(start.x);
  let f32z = Math.fround(start.z);
  const step = Math.fround(Math.fround(SPEED) * Math.fround(DT));
  for (let i = 0; i < FRAMES; i += 1) {
    f32x = Math.fround(f32x);
    f32z = Math.fround(f32z + step);
  }

  const analytic = vec3(AU, 0, SPEED * FRAMES * DT);
  const errorF64 = distance(f64, analytic);
  const errorF32 = Math.hypot(f32x - analytic.x, f32z - analytic.z);

  console.log(`  travelled ${(SPEED * FRAMES * DT) / 1000} km at ${AU / 1000} km from origin`);
  console.log(`  float64 error: ${errorF64.toExponential(3)} m`);
  console.log(`  float32 error: ${errorF32.toFixed(1)} m`);
  check('float64 holds the centimetre', errorF64 < 0.01, `${errorF64.toExponential(3)} m`);
  check('float32 demonstrably does not', errorF32 > 1, `${errorF32.toFixed(1)} m drift`);
}

heading('2. Scene coordinates stay small under floating origin');
{
  const ship = vec3(AU, 0, 0);
  const observer = vec3(AU + 100, 0, 0);
  const scene = vec3();
  let worst = 0;
  for (let i = 0; i < FRAMES; i += 1) {
    ship.z += SPEED * DT;
    observer.z += SPEED * DT;
    place(ship, observer, 0, scene);
    worst = Math.max(worst, Math.abs(length(scene) - 100));
  }
  check('offset reproduced exactly every frame', worst < 1e-6, `worst ${worst.toExponential(3)} m`);
  check('scene magnitude stays tiny', length(scene) < 1000, `${length(scene).toFixed(3)} m`);
}

heading('3. Render placement');
{
  const earth = BODIES.earth.radius;
  const lowOrbit = placementFor(earth + 400000, earth);
  check('400 km above Earth draws at true scale', !lowOrbit.far && lowOrbit.scale === 1);

  const justOutside = placementFor(earth + SURFACE_SHELL * 1.0001, earth);
  check('the boundary is continuous', Math.abs(justOutside.scale - 1) < 1e-4, `scale ${justOutside.scale.toFixed(6)}`);

  const trueScaleReach = earth + SURFACE_SHELL + earth;
  check('a true-scale planet fits the near camera', trueScaleReach < NEAR_FAR_PLANE, `${(trueScaleReach / 1e6).toFixed(0)} Mm`);

  const samples = [2e7, 4e8, 1.5e11, 2.3e11, 7.8e11];
  let angularOk = true;
  let monotonic = true;
  let previous = -Infinity;
  for (const d of samples) {
    const p = placementFor(d, earth);
    const trueAngular = 1 / d;
    const drawnAngular = p.scale / p.distance;
    if (Math.abs(trueAngular - drawnAngular) / trueAngular > 1e-12) angularOk = false;
    if (p.distance <= previous) monotonic = false;
    previous = p.distance;
  }
  check('angular size preserved for every sample', angularOk);
  check('depth order preserved (monotonic shell)', monotonic);

  const sun = BODIES.sun.radius;
  const furthest = placementFor(40 * 1.496e11, sun).distance;
  check('the Sun seen from Pluto still fits the far camera', furthest < FAR_FAR_PLANE, `${(furthest / 1e9).toFixed(2)} Gm`);
}

heading('4. Solar System geometry');
{
  const positions = Object.fromEntries(BODY_IDS.map((id) => [id, positionAt(id, 0)]));
  const earthSun = length(positions.earth);
  const moonEarth = distance(positions.moon, positions.earth);
  const marsSun = length(positions.mars);

  check('Earth sits at 1 AU', Math.abs(earthSun - AU) / AU < 1e-6, `${(earthSun / 1e9).toFixed(3)} Gm`);
  check('Moon sits at 384 400 km', Math.abs(moonEarth - 384400000) < 1000, `${(moonEarth / 1000).toFixed(0)} km`);
  check('Mars sits at 1.5237 AU', Math.abs(marsSun / AU - 1.523679) < 1e-6, `${(marsSun / AU).toFixed(4)} AU`);

  const oneYear = positionAt('earth', 365.256 * 86400, vec3());
  const drift = distance(oneYear, positions.earth);
  check('Earth returns after one orbit', drift < 1000, `${drift.toFixed(1)} m`);

  const delta = vec3();
  sub(delta, positions.mars, positions.earth);
  console.log(`  Earth to Mars right now: ${(length(delta) / 1e9).toFixed(1)} Gm`);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
