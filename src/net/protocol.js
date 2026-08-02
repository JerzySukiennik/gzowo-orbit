// What crosses the wire. Pure functions, no transport, no three.js - so the same file
// runs in the browser, in the node tests, and in whatever hosts a crew later.
//
// Commands go up, facts come down. A guest never changes the world; it says what its
// hands are doing and draws whatever the host says happened. That is the only rule that
// keeps four people from disagreeing about where the ship is.

export const SNAPSHOT_RATE = 20;

const round = (value, places) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const vector = (v, places = 2) => [round(v.x, places), round(v.y, places), round(v.z, places)];
const readVector = (out, a) => {
  out.x = a[0];
  out.y = a[1];
  out.z = a[2];
  return out;
};

export function encodeSnapshot(state) {
  return {
    t: round(state.time, 3),
    s: {
      f: state.ship.frame,
      p: vector(state.ship.position, 2),
      v: vector(state.ship.velocity, 3),
      q: [
        round(state.ship.orientation.x, 5),
        round(state.ship.orientation.y, 5),
        round(state.ship.orientation.z, 5),
        round(state.ship.orientation.w, 5),
      ],
      fu: round(state.ship.fuel, 0),
      h: round(state.ship.hull, 3),
      c: [round(state.ship.controls.main, 3), round(state.ship.controls.lift, 3), state.ship.controls.gear ? 1 : 0],
      l: state.ship.landed ? 1 : 0,
    },
    c: state.crew.map((member) => ({
      i: member.id,
      n: member.name,
      a: member.aboard ? 1 : 0,
      p: vector(member.position, 2),
      y: round(member.yaw, 3),
      s: member.seat || '',
      f: member.frame || '',
      o: round(member.oxygen || 0, 0),
    })),
  };
}

export function decodeSnapshot(packet, out = { ship: {}, crew: [] }) {
  out.time = packet.t;
  out.ship.frame = packet.s.f;
  out.ship.position = readVector(out.ship.position || {}, packet.s.p);
  out.ship.velocity = readVector(out.ship.velocity || {}, packet.s.v);
  out.ship.orientation = { x: packet.s.q[0], y: packet.s.q[1], z: packet.s.q[2], w: packet.s.q[3] };
  out.ship.fuel = packet.s.fu;
  out.ship.hull = packet.s.h;
  out.ship.controls = { main: packet.s.c[0], lift: packet.s.c[1], gear: packet.s.c[2] === 1 };
  out.ship.landed = packet.s.l === 1;
  out.crew = packet.c.map((member) => ({
    id: member.i,
    name: member.n,
    aboard: member.a === 1,
    position: readVector({}, member.p),
    yaw: member.y,
    seat: member.s || null,
    frame: member.f || null,
    oxygen: member.o,
  }));
  return out;
}

export function encodeInput(input) {
  return {
    k: [
      round(input.pitch, 3),
      round(input.yaw, 3),
      round(input.roll, 3),
      round(input.main, 3),
      round(input.lift, 3),
      round(input.strafe, 3),
      round(input.vertical, 3),
    ],
    w: [round(input.walkForward, 2), round(input.walkStrafe, 2), input.run ? 1 : 0, input.jump ? 1 : 0],
    l: [round(input.lookYaw, 3), round(input.lookPitch, 3)],
    a: input.actions || 0,
  };
}

export function decodeInput(packet) {
  return {
    pitch: packet.k[0],
    yaw: packet.k[1],
    roll: packet.k[2],
    main: packet.k[3],
    lift: packet.k[4],
    strafe: packet.k[5],
    vertical: packet.k[6],
    walkForward: packet.w[0],
    walkStrafe: packet.w[1],
    run: packet.w[2] === 1,
    jump: packet.w[3] === 1,
    lookYaw: packet.l[0],
    lookPitch: packet.l[1],
    actions: packet.a,
  };
}

export const ACTION = { SIT: 1, LIFT: 2, AIRLOCK: 4, GEAR: 8, JUMP_CYCLE: 16, JUMP_ENGAGE: 32 };

// Guests draw a smoothed version of the last two snapshots rather than the newest one.
// Snapping to whatever arrived last makes a ship that teleports every time a packet is
// late; a fixed delay of one snapshot period buys interpolation instead.
export function interpolate(previous, next, alpha, out) {
  const t = Math.max(0, Math.min(1, alpha));
  out.x = previous.x + (next.x - previous.x) * t;
  out.y = previous.y + (next.y - previous.y) * t;
  out.z = previous.z + (next.z - previous.z) * t;
  return out;
}

export function slerp(previous, next, alpha, out) {
  let dot = previous.x * next.x + previous.y * next.y + previous.z * next.z + previous.w * next.w;
  let target = next;
  if (dot < 0) {
    target = { x: -next.x, y: -next.y, z: -next.z, w: -next.w };
    dot = -dot;
  }
  const t = Math.max(0, Math.min(1, alpha));
  if (dot > 0.9995) {
    out.x = previous.x + (target.x - previous.x) * t;
    out.y = previous.y + (target.y - previous.y) * t;
    out.z = previous.z + (target.z - previous.z) * t;
    out.w = previous.w + (target.w - previous.w) * t;
  } else {
    const theta = Math.acos(dot);
    const sin = Math.sin(theta);
    const a = Math.sin((1 - t) * theta) / sin;
    const b = Math.sin(t * theta) / sin;
    out.x = previous.x * a + target.x * b;
    out.y = previous.y * a + target.y * b;
    out.z = previous.z * a + target.z * b;
    out.w = previous.w * a + target.w * b;
  }
  const length = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= length;
  out.y /= length;
  out.z /= length;
  out.w /= length;
  return out;
}
