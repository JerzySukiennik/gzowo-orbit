// Cube-sphere mapping and tile arithmetic. Pure float64, no three.js.
//
// The cube face warp is tan-based rather than the usual sqrt one because it inverts
// exactly: a walking astronaut has to turn a direction back into a patch coordinate to
// find the ground under their boots, and a numerical inverse would put them under it.

const HALF_PI_4 = Math.PI / 4;

export const FACES = [
  { forward: [1, 0, 0], right: [0, 0, -1], up: [0, 1, 0] },
  { forward: [-1, 0, 0], right: [0, 0, 1], up: [0, 1, 0] },
  { forward: [0, 1, 0], right: [1, 0, 0], up: [0, 0, 1] },
  { forward: [0, -1, 0], right: [1, 0, 0], up: [0, 0, -1] },
  { forward: [0, 0, 1], right: [1, 0, 0], up: [0, 1, 0] },
  { forward: [0, 0, -1], right: [-1, 0, 0], up: [0, 1, 0] },
];

export function faceUvToDirection(face, u, v, out = { x: 0, y: 0, z: 0 }) {
  const f = FACES[face];
  const a = Math.tan(u * HALF_PI_4);
  const b = Math.tan(v * HALF_PI_4);
  const x = f.forward[0] + f.right[0] * a + f.up[0] * b;
  const y = f.forward[1] + f.right[1] * a + f.up[1] * b;
  const z = f.forward[2] + f.right[2] * a + f.up[2] * b;
  const len = Math.hypot(x, y, z);
  out.x = x / len;
  out.y = y / len;
  out.z = z / len;
  return out;
}

export function directionToFaceUv(direction, out = { face: 0, u: 0, v: 0 }) {
  const { x, y, z } = direction;
  const ax = Math.abs(x);
  const ay = Math.abs(y);
  const az = Math.abs(z);
  let face;
  if (ax >= ay && ax >= az) face = x >= 0 ? 0 : 1;
  else if (ay >= az) face = y >= 0 ? 2 : 3;
  else face = z >= 0 ? 4 : 5;

  const f = FACES[face];
  const forward = f.forward[0] * x + f.forward[1] * y + f.forward[2] * z;
  const right = f.right[0] * x + f.right[1] * y + f.right[2] * z;
  const up = f.up[0] * x + f.up[1] * y + f.up[2] * z;
  out.face = face;
  out.u = Math.atan(right / forward) / HALF_PI_4;
  out.v = Math.atan(up / forward) / HALF_PI_4;
  return out;
}

export function directionToLatLon(direction, out = { lat: 0, lon: 0 }) {
  out.lat = Math.asin(Math.max(-1, Math.min(1, direction.y)));
  out.lon = Math.atan2(direction.z, direction.x);
  return out;
}

export function latLonToDirection(lat, lon, out = { x: 0, y: 0, z: 0 }) {
  const c = Math.cos(lat);
  out.x = c * Math.cos(lon);
  out.y = Math.sin(lat);
  out.z = c * Math.sin(lon);
  return out;
}

export const MERCATOR_LIMIT = 85.05112878 * (Math.PI / 180);

export function lonLatToMercator(lon, lat) {
  const clamped = Math.max(-MERCATOR_LIMIT, Math.min(MERCATOR_LIMIT, lat));
  return {
    x: (lon / Math.PI + 1) / 2,
    y: (1 - Math.log(Math.tan(clamped) + 1 / Math.cos(clamped)) / Math.PI) / 2,
  };
}

export function lonLatToEquirect(lon, lat) {
  return { x: (lon / Math.PI + 1) / 2, y: 0.5 - lat / Math.PI };
}

export function degrees(radians) {
  return (radians * 180) / Math.PI;
}
