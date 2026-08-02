// Phase 6 acceptance test: the protocol and the host-authoritative loop, exercised over a
// loopback transport. No browser, no network, no second machine - if a snapshot cannot
// survive this, it will not survive a real connection either.

import { encodeSnapshot, decodeSnapshot, encodeInput, decodeInput, interpolate, slerp } from '../src/net/protocol.js';
import { CrewSession, LoopbackTransport } from '../src/net/session.js';
import { createShip, updateShip } from '../src/ship/flight.js';
import { circularSpeed } from '../src/shared/orbit.js';
import { BODIES } from '../src/shared/bodies.js';
import { vec3, set, distance, length } from '../src/shared/vec3.js';

let failures = 0;
const check = (name, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` - ${detail}` : ''}`);
};
const heading = (text) => console.log(`\n${text}`);

function makeState(ship, time) {
  return {
    time,
    ship,
    crew: [
      { id: 'a', name: 'Jurek', aboard: true, position: { x: 0, y: 0, z: -52 }, yaw: 0, seat: 'pilot' },
      { id: 'b', name: 'Guest', aboard: false, position: { x: 12, y: 3, z: -4 }, yaw: 1.2, frame: 'earth', oxygen: 900 },
    ],
  };
}

heading('1. A snapshot survives the round trip');
{
  const radius = BODIES.earth.radius + 400000;
  const ship = createShip('earth', vec3(radius, 0, 0), vec3(0, 0, circularSpeed('earth', radius)));
  ship.controls.main = 0.42;
  ship.controls.lift = 0.1;
  const packet = encodeSnapshot(makeState(ship, 12.5));
  const decoded = decodeSnapshot(JSON.parse(JSON.stringify(packet)));

  check('position within a centimetre', distance(decoded.ship.position, ship.position) < 0.02, `${distance(decoded.ship.position, ship.position).toFixed(4)} m`);
  check('velocity within a millimetre per second', distance(decoded.ship.velocity, ship.velocity) < 0.002);
  check('frame survives', decoded.ship.frame === 'earth');
  check('throttles survive', Math.abs(decoded.ship.controls.main - 0.42) < 1e-6);
  check('two crew members', decoded.crew.length === 2);
  check('the one outside kept their oxygen', decoded.crew[1].oxygen === 900);
  check('the one aboard kept their seat', decoded.crew[0].seat === 'pilot');

  const bytes = JSON.stringify(packet).length;
  console.log(`  ${bytes} bytes per snapshot, ${(bytes * 20 / 1024).toFixed(1)} kB/s per guest at 20 Hz`);
  check('a snapshot fits comfortably in a datagram', bytes < 1200, `${bytes} bytes`);
}

heading('2. Input survives the round trip');
{
  const input = {
    pitch: 0.42, yaw: -0.13, roll: 1, main: 0.75, lift: 0.2, strafe: -1, vertical: 0,
    walkForward: 1, walkStrafe: -1, run: true, jump: false, lookYaw: 2.11, lookPitch: -0.4, actions: 5,
  };
  const decoded = decodeInput(JSON.parse(JSON.stringify(encodeInput(input))));
  check('every axis comes back', Math.abs(decoded.pitch - 0.42) < 1e-6 && decoded.roll === 1 && decoded.strafe === -1);
  check('flags come back', decoded.run === true && decoded.jump === false && decoded.actions === 5);
  check('look angles come back', Math.abs(decoded.lookYaw - 2.11) < 1e-6);
}

heading('3. Host and guest agree over a loopback');
{
  const [hostSide, guestSide] = LoopbackTransport.pair();
  const host = new CrewSession();
  const guest = new CrewSession();
  host.attachLoopback(hostSide, 'host');
  guest.attachLoopback(guestSide, 'guest');

  const radius = BODIES.earth.radius + 400000;
  const ship = createShip('earth', vec3(radius, 0, 0), vec3(0, 0, circularSpeed('earth', radius)));

  let time = 0;
  let sent = 0;
  for (let i = 0; i < 600; i += 1) {
    guest.sendInput({
      pitch: 0, yaw: 0, roll: 0, main: i > 200 ? 0.5 : 0, lift: 0, strafe: 0, vertical: 0,
      walkForward: 0, walkStrafe: 0, run: false, jump: false, lookYaw: 0, lookPitch: 0, actions: 0,
    });
    // The host is the only thing that touches the world, and it reads the guest's input
    // exactly like its own.
    const remote = host.inputs.get('loopback');
    if (remote) ship.controls.main = remote.main;
    updateShip(ship, { groundAltitude: length(ship.position) - BODIES.earth.radius }, 1 / 60);
    time += 1 / 60;
    if (host.broadcast(makeState(ship, time), time)) sent += 1;
  }

  check('the guest received snapshots', guest.guestState !== null);
  check('exactly one snapshot per 50 ms', Math.abs(sent - 200) < 3, `${sent} in 10 s`);

  // The guest is always one snapshot behind, and at orbital speed that is hundreds of
  // metres. The honest bound is the distance the ship covers in one period, not zero.
  const lag = distance(guest.guestState.ship.position, ship.position);
  const budget = length(ship.velocity) / 20;
  check('the guest is within one snapshot of travel', lag < budget, `${lag.toFixed(0)} m of ${budget.toFixed(0)} m`);
  check('the guest sees the throttle the guest asked for', Math.abs(guest.guestState.ship.controls.main - 0.5) < 1e-6);
  check('a guest never simulates', guest.role === 'guest' && guest.broadcast(makeState(ship, time), time) === false);
}

heading('4. Interpolation');
{
  const out = vec3();
  interpolate({ x: 0, y: 0, z: 0 }, { x: 10, y: -4, z: 2 }, 0.5, out);
  check('halfway is halfway', out.x === 5 && out.y === -2 && out.z === 1);

  const q = { x: 0, y: 0, z: 0, w: 1 };
  const half = Math.SQRT1_2;
  const result = slerp(q, { x: 0, y: half, z: 0, w: half }, 0.5, { x: 0, y: 0, z: 0, w: 1 });
  const angle = 2 * Math.acos(Math.min(1, Math.abs(result.w)));
  check('slerp lands on 45 degrees', Math.abs(angle - Math.PI / 4) < 1e-6, `${((angle * 180) / Math.PI).toFixed(3)}°`);
  check('slerp stays unit length', Math.abs(Math.hypot(result.x, result.y, result.z, result.w) - 1) < 1e-9);

  const flipped = slerp(q, { x: 0, y: -half, z: 0, w: -half }, 0.5, { x: 0, y: 0, z: 0, w: 1 });
  check('slerp takes the short way round', Math.sign(flipped.y) === Math.sign(half) || Math.abs(flipped.y) < 1e-9);
}

console.log('');
if (failures > 0) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
