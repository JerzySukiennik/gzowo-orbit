// Phase 2 acceptance test: the flight model has to hold an orbit, hover, fall correctly
// and break the gear at the speed it says it will. Run with: npm run test:flight

import { vec3, set, length } from '../src/shared/vec3.js';
import { BODIES } from '../src/shared/bodies.js';
import { elements, circularSpeed, airDensity } from '../src/shared/orbit.js';
import { createShip, updateShip, shipMass, SHIP } from '../src/ship/flight.js';

let failures = 0;

function check(name, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
}

function heading(text) {
  console.log(`\n${text}`);
}

function run(ship, seconds, dt, controls) {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) {
    if (controls) Object.assign(ship.controls, controls(ship, i * dt));
    const radius = length(ship.position);
    updateShip(ship, { groundAltitude: radius - BODIES[ship.frame].radius }, dt);
  }
  return ship;
}

heading('1. A parked orbit stays an orbit');
{
  const radius = BODIES.earth.radius + 400000;
  const speed = circularSpeed('earth', radius);
  const ship = createShip('earth', vec3(radius, 0, 0), vec3(0, 0, speed));
  const before = elements('earth', ship.position, ship.velocity);
  run(ship, 5560, 0.05, null);
  const after = elements('earth', ship.position, ship.velocity);

  const apoDrift = Math.abs(after.apoapsis - before.apoapsis);
  const periDrift = Math.abs(after.periapsis - before.periapsis);
  console.log(`  one period is ${(before.period / 60).toFixed(1)} min at ${speed.toFixed(0)} m/s`);
  check('eccentricity starts circular', before.eccentricity < 1e-9, before.eccentricity.toExponential(2));
  check('apoapsis holds within 1 km', apoDrift < 1000, `${apoDrift.toFixed(1)} m`);
  check('periapsis holds within 1 km', periDrift < 1000, `${periDrift.toFixed(1)} m`);
  check('the ship came back around', length(ship.position) > radius - 2000, `${(length(ship.position) / 1000).toFixed(1)} km`);
}

heading('2. Hover on the Moon holds altitude');
{
  const radius = BODIES.moon.radius + 60;
  const ship = createShip('moon', vec3(0, radius, 0), vec3(0, 0, 0));
  set(ship.orientation, 0, 0, 0, 1);
  const weight = shipMass(ship) * BODIES.moon.surfaceGravity;
  const throttle = weight / SHIP.liftThrust;
  ship.controls.gear = false;
  run(ship, 40, 0.02, () => ({ lift: throttle }));
  const drift = length(ship.position) - radius;
  console.log(`  hover throttle ${(throttle * 100).toFixed(1)}% of lift thrust`);
  check('altitude holds within 2 m over 40 s', Math.abs(drift) < 2, `${drift.toFixed(2)} m`);
  check('fuel burned is finite and sane', ship.fuel < SHIP.fuelCapacity && ship.fuel > 0, `${Math.round(SHIP.fuelCapacity - ship.fuel)} kg`);
}

heading('3. Free fall matches the analytic answer');
{
  const drop = 2000;
  const radius = BODIES.moon.radius + drop;
  const ship = createShip('moon', vec3(0, radius, 0), vec3(0, 0, 0));
  ship.controls.gear = false;
  run(ship, 30, 0.01, null);
  const fallen = radius - length(ship.position);
  const g = BODIES.moon.surfaceGravity;
  const analytic = 0.5 * g * 30 * 30;
  const error = Math.abs(fallen - analytic) / analytic;
  console.log(`  fell ${fallen.toFixed(1)} m, analytic ${analytic.toFixed(1)} m`);
  check('within 1% of 0.5*g*t^2', error < 0.01, `${(error * 100).toFixed(3)}%`);
}

heading('4. The gear breaks exactly when it says it does');
{
  const gentle = createShip('moon', vec3(0, BODIES.moon.radius + SHIP.gearHeight, 0), vec3(0, -4, 0));
  run(gentle, 6, 0.005, null);
  check('4 m/s touchdown leaves the hull intact', gentle.hull === 1, `hull ${gentle.hull.toFixed(2)}`);
  check('4 m/s touchdown ends up landed', gentle.landed, `contact ${gentle.contact.toFixed(2)}`);

  const hard = createShip('moon', vec3(0, BODIES.moon.radius + SHIP.gearHeight, 0), vec3(0, -14, 0));
  run(hard, 6, 0.005, null);
  check('14 m/s touchdown damages the hull', hard.hull < 1, `hull ${hard.hull.toFixed(2)}`);
}

heading('5. Air is where it should be');
{
  const sea = airDensity('earth', 0);
  const cruise = airDensity('earth', 8500);
  const space = airDensity('earth', 200000);
  check('sea level is 1.225 kg/m3', Math.abs(sea - 1.225) < 1e-6, sea.toFixed(3));
  check('one scale height is 1/e of that', Math.abs(cruise / sea - Math.exp(-1)) < 1e-6);
  check('there is no air at 200 km', space === 0);
  check('the Moon has no air at all', airDensity('moon', 0) === 0);
}

heading('6. Wings do something once there is air');
{
  const radius = BODIES.earth.radius + 4000;
  const glider = createShip('earth', vec3(0, radius, 0), vec3(0, 0, -220));
  glider.controls.gear = false;
  run(glider, 20, 0.01, null);
  const withWings = radius - length(glider.position);

  const ballistic = createShip('earth', vec3(0, radius, 0), vec3(0, 0, -220));
  ballistic.controls.gear = false;
  const original = SHIP.wingArea;
  SHIP.wingArea = 0;
  run(ballistic, 20, 0.01, null);
  SHIP.wingArea = original;
  const withoutWings = radius - length(ballistic.position);

  console.log(`  fell ${withWings.toFixed(0)} m with wings, ${withoutWings.toFixed(0)} m without`);
  check('wings measurably slow the fall', withWings < withoutWings - 20, `${(withoutWings - withWings).toFixed(0)} m less`);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
