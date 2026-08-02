// Deterministic value noise. Shared by the workers that build terrain and by the main
// thread that answers height queries, so both must return bit-identical results - hence
// integer hashing rather than anything seeded by object identity or iteration order.

function hash3(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function valueNoise(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const zf = smooth(z - zi);

  const c000 = hash3(xi, yi, zi);
  const c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi);
  const c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1);
  const c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1);
  const c111 = hash3(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * xf;
  const x10 = c010 + (c110 - c010) * xf;
  const x01 = c001 + (c101 - c001) * xf;
  const x11 = c011 + (c111 - c011) * xf;
  const y0 = x00 + (x10 - x00) * yf;
  const y1 = x01 + (x11 - x01) * yf;
  return (y0 + (y1 - y0) * zf) * 2 - 1;
}

export function fbm(x, y, z, octaves = 6, lacunarity = 2.03, gain = 0.5) {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * frequency, y * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return sum / norm;
}

export function ridged(x, y, z, octaves = 6, lacunarity = 2.07, gain = 0.5) {
  let sum = 0;
  let amplitude = 1;
  let frequency = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(valueNoise(x * frequency, y * frequency, z * frequency));
    sum += n * n * amplitude;
    norm += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return (sum / norm) * 2 - 1;
}

// Craters as a cellular field: each grid cell owns one crater whose radius and depth come
// from the same hash, so a moon can be rebuilt anywhere without storing a single one.
export function craterField(x, y, z, cellSize, depthScale) {
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);
  const gz = Math.floor(z / cellSize);
  let height = 0;

  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dz = -1; dz <= 1; dz += 1) {
        const cx = gx + dx;
        const cy = gy + dy;
        const cz = gz + dz;
        const jx = (cx + hash3(cx, cy, cz)) * cellSize;
        const jy = (cy + hash3(cx + 71, cy, cz)) * cellSize;
        const jz = (cz + hash3(cx, cy + 131, cz)) * cellSize;
        const presence = hash3(cx + 17, cy + 29, cz + 43);
        if (presence < 0.45) continue;

        const radius = cellSize * (0.16 + hash3(cx, cy, cz + 7) * 0.34);
        const distance = Math.hypot(x - jx, y - jy, z - jz);
        if (distance > radius * 1.6) continue;

        const t = distance / radius;
        const depth = depthScale * radius * (0.5 + presence * 0.5);
        if (t < 1) height -= depth * (1 - t * t) * 0.9;
        else height += depth * 0.55 * Math.pow(1 - (t - 1) / 0.6, 2);
      }
    }
  }
  return height;
}
