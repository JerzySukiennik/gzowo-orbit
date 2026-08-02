// The interior as data. Both the Blender model and the collision are generated from this
// one description, so a wall can never end up in a place you can walk through.
//
// Ship space, metres: forward is -Z, up is +Y, the deck floor is y = 0.

export const DECK = {
  floor: 0,
  ceiling: 3.3,
  upperFloor: 4.6,
  upperCeiling: 7.4,
  wall: 0.35,
  doorWidth: 2.2,
  doorHeight: 2.5,
};

// Every room is an axis-aligned box of open air. Walls are what is left between them.
export const ROOMS = [
  { id: 'bridge', name: 'Bridge', x: [-8.6, 8.6], z: [-58, -42], level: 0 },
  { id: 'forward', name: 'Forward passage', x: [-2.4, 2.4], z: [-42, -26], level: 0 },
  { id: 'medbay', name: 'Medical', x: [-10.5, -2.4], z: [-26, -14], level: 0 },
  { id: 'mess', name: 'Mess', x: [2.4, 10.5], z: [-26, -14], level: 0 },
  { id: 'spine', name: 'Spine', x: [-2.4, 2.4], z: [-26, 4], level: 0 },
  { id: 'airlock', name: 'Airlock', x: [2.4, 9.0], z: [-6, 0], level: 0 },
  { id: 'hold', name: 'Cargo hold', x: [-11.5, 11.5], z: [4, 24], level: 0, ceiling: 5.6 },
  { id: 'engineering', name: 'Engineering', x: [-8.6, 8.6], z: [24, 38], level: 0 },
  { id: 'observation', name: 'Observation', x: [-5.5, 5.5], z: [-20, -6], level: 1 },
];

// Doorways are holes cut in the wall between two rooms. The pair is enough: the wall
// plane is wherever the two boxes meet.
export const DOORS = [
  { between: ['bridge', 'forward'], at: 0 },
  { between: ['forward', 'medbay'], at: -20 },
  { between: ['forward', 'mess'], at: -20 },
  { between: ['forward', 'spine'], at: 0 },
  { between: ['spine', 'airlock'], at: -3 },
  { between: ['spine', 'hold'], at: 0 },
  { between: ['hold', 'engineering'], at: 0 },
];

export const LIFT = { x: [-2.0, 2.0], z: [-13.5, -9.5], bottom: DECK.floor, top: DECK.upperFloor, speed: 1.35 };

export const SEATS = [
  { id: 'pilot', name: 'Pilot', role: 'flies the ship', position: { x: 0, y: 0, z: -52 }, facing: 0 },
  { id: 'navigator', name: 'Navigator', role: 'sets the jump', position: { x: -4.2, y: 0, z: -48 }, facing: 0.28 },
  { id: 'scanner', name: 'Scanner', role: 'reads the surface', position: { x: 4.2, y: 0, z: -48 }, facing: -0.28 },
  { id: 'engineer', name: 'Engineer', role: 'power and repair', position: { x: 0, y: 0, z: -44.5 }, facing: Math.PI },
];

export const AIRLOCK_DOOR = { x: 9.0, z: [-5, -1], y: [0, 2.4] };

const EYE = 1.68;
const RADIUS = 0.42;

function roomCeiling(room) {
  if (room.level === 1) return DECK.upperCeiling;
  return room.ceiling !== undefined ? room.ceiling : DECK.ceiling;
}

function roomFloor(room) {
  return room.level === 1 ? DECK.upperFloor : DECK.floor;
}

export function roomAt(position) {
  for (const room of ROOMS) {
    if (
      position.x >= room.x[0] &&
      position.x <= room.x[1] &&
      position.z >= room.z[0] &&
      position.z <= room.z[1] &&
      position.y >= roomFloor(room) - 0.6 &&
      position.y <= roomCeiling(room) + 0.4
    ) {
      return room;
    }
  }
  return null;
}

export function inLift(position) {
  return (
    position.x >= LIFT.x[0] &&
    position.x <= LIFT.x[1] &&
    position.z >= LIFT.z[0] &&
    position.z <= LIFT.z[1]
  );
}

function insideDoorway(door, x, y, z) {
  if (y > DECK.doorHeight) return false;
  const half = DECK.doorWidth / 2;
  const a = ROOMS.find((r) => r.id === door.between[0]);
  const b = ROOMS.find((r) => r.id === door.between[1]);
  if (!a || !b) return false;
  const sharedZ = Math.abs(a.z[1] - b.z[0]) < 0.01 || Math.abs(b.z[1] - a.z[0]) < 0.01;
  if (sharedZ) return Math.abs(x - door.at) < half;
  return Math.abs(z - door.at) < half;
}

// Collision is a slide against room boundaries rather than a physics solver: the deck is
// a set of boxes, and a crew member is a capsule that stops at a wall unless a doorway
// happens to be there. It is deterministic, it costs nothing, and the server can run it.
export function resolveWalk(from, to, liftHeight) {
  const result = { x: to.x, y: to.y, z: to.z, room: null, grounded: false };
  const room = roomAt({ x: to.x, y: from.y, z: to.z }) || roomAt(from);
  if (!room) {
    result.x = from.x;
    result.z = from.z;
    result.room = roomAt(from);
    return result;
  }

  const onLift = inLift(result);
  const floor = onLift ? liftHeight : roomFloor(room);
  const ceiling = roomCeiling(room);

  for (const axis of ['x', 'z']) {
    const candidate = { x: result.x, y: from.y, z: result.z };
    const target = roomAt(candidate);
    if (target) continue;
    const openDoor = DOORS.some((door) => insideDoorway(door, candidate.x, from.y - floor, candidate.z));
    if (!openDoor) result[axis] = from[axis];
  }

  const limits = roomAt({ x: result.x, y: from.y, z: result.z });
  if (limits) {
    const inset = RADIUS;
    result.x = Math.max(limits.x[0] + inset, Math.min(limits.x[1] - inset, result.x));
    result.z = Math.max(limits.z[0] + inset, Math.min(limits.z[1] - inset, result.z));
    if (
      DOORS.some((door) => insideDoorway(door, to.x, from.y - floor, to.z))
    ) {
      result.x = to.x;
      result.z = to.z;
    }
  }

  result.y = Math.max(floor, Math.min(ceiling - EYE, result.y));
  result.grounded = result.y <= floor + 0.001;
  result.room = roomAt(result) || room;
  return result;
}

export const CREW = { eyeHeight: EYE, radius: RADIUS, walkSpeed: 3.1, floatSpeed: 1.9 };
