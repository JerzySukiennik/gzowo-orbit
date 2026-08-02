// Minimal quaternion maths on plain objects, so the flight model stays free of three.js.

export function quat(x = 0, y = 0, z = 0, w = 1) {
  return { x, y, z, w };
}

export function normalizeQuat(q) {
  const len = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= len;
  q.y /= len;
  q.z /= len;
  q.w /= len;
  return q;
}

export function multiply(out, a, b) {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  out.x = x;
  out.y = y;
  out.z = z;
  out.w = w;
  return out;
}

export function fromAxisAngle(out, axis, angle) {
  const half = angle / 2;
  const s = Math.sin(half);
  out.x = axis.x * s;
  out.y = axis.y * s;
  out.z = axis.z * s;
  out.w = Math.cos(half);
  return out;
}

export function rotateVector(out, v, q) {
  const ix = q.w * v.x + q.y * v.z - q.z * v.y;
  const iy = q.w * v.y + q.z * v.x - q.x * v.z;
  const iz = q.w * v.z + q.x * v.y - q.y * v.x;
  const iw = -q.x * v.x - q.y * v.y - q.z * v.z;
  out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return out;
}

const spin = quat();

// Integrating orientation by the angular velocity as a quaternion derivative rather than
// by euler steps: a ship tumbling in vacuum has no preferred axis, and euler integration
// of that quietly gains energy.
export function integrateOrientation(q, angularVelocity, dt) {
  spin.x = angularVelocity.x * dt * 0.5;
  spin.y = angularVelocity.y * dt * 0.5;
  spin.z = angularVelocity.z * dt * 0.5;
  spin.w = 0;
  const dx = spin.w * q.x + spin.x * q.w + spin.y * q.z - spin.z * q.y;
  const dy = spin.w * q.y - spin.x * q.z + spin.y * q.w + spin.z * q.x;
  const dz = spin.w * q.z + spin.x * q.y - spin.y * q.x + spin.z * q.w;
  const dw = spin.w * q.w - spin.x * q.x - spin.y * q.y - spin.z * q.z;
  q.x += dx;
  q.y += dy;
  q.z += dz;
  q.w += dw;
  return normalizeQuat(q);
}
