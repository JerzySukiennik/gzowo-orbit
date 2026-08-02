// Builds one terrain patch off the main thread: fetches elevation and imagery tiles,
// samples them into a cube-sphere quad, and hands back transferable buffers.
//
// The colour texture is painted in PATCH space, not in a lat/lon box. A patch that
// contains a pole or straddles the antimeridian has no sane lat/lon rectangle, and every
// projection-space approach needs a special case for both. Sampling per texel removes
// the special cases entirely at the cost of one atan2 per texel.

import { faceUvToDirection, directionToLatLon, lonLatToMercator, degrees } from '../shared/geodesy.js';
import { proceduralHeight, detailHeight } from '../shared/terrainheight.js';

const ELEVATION_MAX_ZOOM = 15;
const IMAGERY_MAX_ZOOM = 7;

// Measured against the live service, not assumed: the GIBS EPSG:4326 500m matrix set is
// NOT a power-of-two pyramid. Its tiles are 288 degrees wide at level 0 and halve from
// there, which gives grids of 2x1, 3x2, 5x3, 10x5, 20x10 ... The obvious 2^(z+1) guess
// addresses rows that do not exist and the service answers 400 for every one of them.
const IMAGERY_TOP_DEG = 288;

function imageryGrid(zoom) {
  const tileDeg = IMAGERY_TOP_DEG / 2 ** zoom;
  return { tileDeg, cols: Math.ceil(360 / tileDeg), rows: Math.ceil(180 / tileDeg) };
}

function imageryCell(grid, lon, lat) {
  let lonDeg = degrees(lon);
  lonDeg = (((lonDeg + 180) % 360) + 360) % 360 - 180;
  const latDeg = Math.max(-90, Math.min(90, degrees(lat)));
  const fx = (lonDeg + 180) / grid.tileDeg;
  const fy = (90 - latDeg) / grid.tileDeg;
  const col = Math.max(0, Math.min(grid.cols - 1, Math.floor(fx)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor(fy)));
  return { col, row, px: fx - col, py: fy - row };
}
const ELEVATION_TILE = 256;
const IMAGERY_TILE = 512;
const MAX_TILES_PER_PATCH = 16;
const CACHE_LIMIT = 260;

const cache = new Map();
const pending = new Map();

function elevationUrl(z, x, y) {
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
}

function imageryUrl(z, row, col) {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/BlueMarble_ShadedRelief_Bathymetry/default/500m/${z}/${row}/${col}.jpeg`;
}

function remember(key, value) {
  cache.set(key, value);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  return value;
}

async function loadTile(key, url, size) {
  if (cache.has(key)) return cache.get(key);
  if (pending.has(key)) return pending.get(key);

  const request = (async () => {
    try {
      const response = await fetch(url);
      if (!response.ok) return remember(key, null);
      const bitmap = await createImageBitmap(await response.blob());
      const canvas = new OffscreenCanvas(size, size);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(bitmap, 0, 0, size, size);
      bitmap.close();
      return remember(key, context.getImageData(0, 0, size, size).data);
    } catch (error) {
      return remember(key, null);
    } finally {
      pending.delete(key);
    }
  })();

  pending.set(key, request);
  return request;
}

function sampleTile(data, size, px, py, channels) {
  const x = Math.max(0, Math.min(size - 1, px));
  const y = Math.max(0, Math.min(size - 1, py));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const out = [0, 0, 0];
  for (let c = 0; c < channels; c += 1) {
    const a = data[(y0 * size + x0) * 4 + c];
    const b = data[(y0 * size + x1) * 4 + c];
    const d = data[(y1 * size + x0) * 4 + c];
    const e = data[(y1 * size + x1) * 4 + c];
    const top = a + (b - a) * fx;
    const bottom = d + (e - d) * fx;
    out[c] = top + (bottom - top) * fy;
  }
  return out;
}

function patchBounds(job, samples = 5) {
  const direction = { x: 0, y: 0, z: 0 };
  const latLon = { lat: 0, lon: 0 };
  let centreLon = 0;
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let touchesPole = false;

  faceUvToDirection(job.face, (job.u0 + job.u1) / 2, (job.v0 + job.v1) / 2, direction);
  directionToLatLon(direction, latLon);
  centreLon = latLon.lon;

  for (let i = 0; i < samples; i += 1) {
    for (let j = 0; j < samples; j += 1) {
      const u = job.u0 + ((job.u1 - job.u0) * i) / (samples - 1);
      const v = job.v0 + ((job.v1 - job.v0) * j) / (samples - 1);
      faceUvToDirection(job.face, u, v, direction);
      directionToLatLon(direction, latLon);
      if (Math.abs(latLon.lat) > 1.4) touchesPole = true;
      let lon = latLon.lon;
      while (lon - centreLon > Math.PI) lon -= 2 * Math.PI;
      while (lon - centreLon < -Math.PI) lon += 2 * Math.PI;
      minLat = Math.min(minLat, latLon.lat);
      maxLat = Math.max(maxLat, latLon.lat);
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
    }
  }

  if (touchesPole) {
    minLon = -Math.PI;
    maxLon = Math.PI;
  }
  return { minLat, maxLat, minLon, maxLon };
}

function chooseZoom(bounds, projection, maxZoom) {
  const a = projection(bounds.minLon, bounds.maxLat);
  const b = projection(bounds.maxLon, bounds.minLat);
  const span = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1e-9);
  const budget = Math.sqrt(MAX_TILES_PER_PATCH) - 1;
  const zoom = Math.floor(Math.log2(budget / span));
  return Math.max(0, Math.min(maxZoom, zoom));
}

async function loadElevation(bounds, diagnostics) {
  const zoom = chooseZoom(bounds, (lon, lat) => lonLatToMercator(lon, lat), ELEVATION_MAX_ZOOM);
  const scale = 2 ** zoom;
  const a = lonLatToMercator(bounds.minLon, bounds.maxLat);
  const b = lonLatToMercator(bounds.maxLon, bounds.minLat);
  const x0 = Math.floor(Math.min(a.x, b.x) * scale);
  const x1 = Math.floor(Math.max(a.x, b.x) * scale);
  const y0 = Math.floor(Math.min(a.y, b.y) * scale);
  const y1 = Math.floor(Math.max(a.y, b.y) * scale);
  diagnostics.elevation = `z${zoom} ${x1 - x0 + 1}x${y1 - y0 + 1}`;
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES_PER_PATCH) {
    diagnostics.elevation += ' too-many';
    return null;
  }

  const tiles = new Map();
  const jobs = [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const wrapped = ((x % scale) + scale) % scale;
      if (y < 0 || y >= scale) continue;
      const key = `e${zoom}/${wrapped}/${y}`;
      jobs.push(
        loadTile(key, elevationUrl(zoom, wrapped, y), ELEVATION_TILE).then((data) => {
          tiles.set(`${wrapped}/${y}`, data);
        })
      );
    }
  }
  await Promise.all(jobs);
  for (const [key, data] of tiles) {
    if (!data) {
      diagnostics.elevation += ` missing:${key}`;
      return null;
    }
  }
  return { zoom, scale, tiles };
}

async function loadImagery(bounds, diagnostics) {
  const spanLon = degrees(bounds.maxLon - bounds.minLon);
  const spanLat = degrees(bounds.maxLat - bounds.minLat);
  const span = Math.max(spanLon, spanLat, 1e-6);
  const zoom = Math.max(0, Math.min(IMAGERY_MAX_ZOOM, Math.floor(Math.log2((IMAGERY_TOP_DEG * 3) / span))));
  const grid = imageryGrid(zoom);
  const a = imageryCell(grid, bounds.minLon, bounds.maxLat);
  const b = imageryCell(grid, bounds.maxLon, bounds.minLat);
  const cols = grid.cols;
  const rows = grid.rows;
  const c0 = Math.min(a.col, b.col);
  const c1 = Math.max(a.col, b.col);
  const r0 = Math.min(a.row, b.row);
  const r1 = Math.max(a.row, b.row);
  diagnostics.imagery = `z${zoom} ${c1 - c0 + 1}x${r1 - r0 + 1}`;
  if ((c1 - c0 + 1) * (r1 - r0 + 1) > MAX_TILES_PER_PATCH) {
    diagnostics.imagery += ' too-many';
    return null;
  }

  const tiles = new Map();
  const jobs = [];
  for (let c = c0; c <= c1; c += 1) {
    for (let r = r0; r <= r1; r += 1) {
      if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
      const key = `i${zoom}/${r}/${c}`;
      jobs.push(
        loadTile(key, imageryUrl(zoom, r, c), IMAGERY_TILE).then((data) => {
          tiles.set(`${c}/${r}`, data);
        })
      );
    }
  }
  await Promise.all(jobs);
  for (const [key, data] of tiles) {
    if (!data) {
      diagnostics.imagery += ` missing:${key}`;
      return null;
    }
  }
  return { zoom, grid, tiles };
}

function readElevation(elevation, lon, lat) {
  const point = lonLatToMercator(lon, lat);
  const fx = point.x * elevation.scale;
  const fy = point.y * elevation.scale;
  const tx = ((Math.floor(fx) % elevation.scale) + elevation.scale) % elevation.scale;
  const ty = Math.floor(fy);
  const data = elevation.tiles.get(`${tx}/${ty}`);
  if (!data) return null;
  const [r, g, b] = sampleTile(data, ELEVATION_TILE, (fx - Math.floor(fx)) * ELEVATION_TILE, (fy - ty) * ELEVATION_TILE, 3);
  return r * 256 + g + b / 256 - 32768;
}

function readImagery(imagery, lon, lat, out) {
  const cell = imageryCell(imagery.grid, lon, lat);
  const data = imagery.tiles.get(`${cell.col}/${cell.row}`);
  if (!data) return false;
  const rgb = sampleTile(data, IMAGERY_TILE, cell.px * IMAGERY_TILE, cell.py * IMAGERY_TILE, 3);
  out[0] = rgb[0];
  out[1] = rgb[1];
  out[2] = rgb[2];
  return true;
}

// Raw RGBA rather than an ImageBitmap on purpose: the pixel buffer is the one texture
// source with no orientation convention and no canvas state attached to it.
function buildTexture(job, imagery, size) {
  const pixels = new Uint8Array(size * size * 4);
  const direction = { x: 0, y: 0, z: 0 };
  const latLon = { lat: 0, lon: 0 };
  const rgb = [0, 0, 0];

  for (let j = 0; j < size; j += 1) {
    const v = job.v0 + ((job.v1 - job.v0) * (j + 0.5)) / size;
    for (let i = 0; i < size; i += 1) {
      const u = job.u0 + ((job.u1 - job.u0) * (i + 0.5)) / size;
      faceUvToDirection(job.face, u, v, direction);
      directionToLatLon(direction, latLon);
      const index = (j * size + i) * 4;
      if (readImagery(imagery, latLon.lon, latLon.lat, rgb)) {
        pixels[index] = rgb[0];
        pixels[index + 1] = rgb[1];
        pixels[index + 2] = rgb[2];
      }
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

async function build(job) {
  const { body, radius, face, u0, u1, v0, v1, resolution } = job;
  const bounds = job.useTiles ? patchBounds(job) : null;
  const diagnostics = { bounds, elevation: 'skipped', imagery: 'skipped' };
  const [elevation, imagery] = job.useTiles
    ? await Promise.all([
        loadElevation(bounds, diagnostics),
        loadImagery(bounds, diagnostics),
      ])
    : [null, null];

  const stride = resolution + 5;
  const heightGrid = new Float64Array(stride * stride);
  const direction = { x: 0, y: 0, z: 0 };
  const latLon = { lat: 0, lon: 0 };
  const du = (u1 - u0) / resolution;
  const dv = (v1 - v0) / resolution;

  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = -2; j <= resolution + 2; j += 1) {
    for (let i = -2; i <= resolution + 2; i += 1) {
      faceUvToDirection(face, u0 + du * i, v0 + dv * j, direction);
      let height;
      if (elevation) {
        directionToLatLon(direction, latLon);
        const sampled = readElevation(elevation, latLon.lon, latLon.lat);
        height = sampled === null ? proceduralHeight(body, direction, radius) : Math.max(0, sampled);
      } else {
        height = proceduralHeight(body, direction, radius);
      }
      height += detailHeight(body, direction);
      heightGrid[(j + 2) * stride + (i + 2)] = height;
      if (i >= 0 && i <= resolution && j >= 0 && j <= resolution) {
        minH = Math.min(minH, height);
        maxH = Math.max(maxH, height);
      }
    }
  }

  const side = resolution + 3;
  const count = side * side;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const ups = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);
  const heights = new Float32Array((resolution + 1) * (resolution + 1));

  faceUvToDirection(face, (u0 + u1) / 2, (v0 + v1) / 2, direction);
  const centre = [direction.x * radius, direction.y * radius, direction.z * radius];

  const cornerA = faceUvToDirection(face, u0, v0, { x: 0, y: 0, z: 0 });
  const cornerB = faceUvToDirection(face, u1, v1, { x: 0, y: 0, z: 0 });
  const patchSize = Math.hypot(cornerA.x - cornerB.x, cornerA.y - cornerB.y, cornerA.z - cornerB.z) * radius;
  const skirt = Math.max(patchSize * 0.06, (maxH - minH) * 1.2 + 40);

  const worldOf = (i, j, out) => {
    const clampedI = Math.max(0, Math.min(resolution, i));
    const clampedJ = Math.max(0, Math.min(resolution, j));
    const apron = clampedI !== i || clampedJ !== j;
    faceUvToDirection(face, u0 + du * clampedI, v0 + dv * clampedJ, direction);
    const height = heightGrid[(clampedJ + 2) * stride + (clampedI + 2)];
    const r = radius + height - (apron ? skirt : 0);
    out[0] = direction.x * r - centre[0];
    out[1] = direction.y * r - centre[1];
    out[2] = direction.z * r - centre[2];
    out[3] = direction.x;
    out[4] = direction.y;
    out[5] = direction.z;
    return apron;
  };

  const point = new Float64Array(6);
  const east = new Float64Array(6);
  const west = new Float64Array(6);
  const north = new Float64Array(6);
  const south = new Float64Array(6);
  let boundingRadius = 0;

  for (let j = -1; j <= resolution + 1; j += 1) {
    for (let i = -1; i <= resolution + 1; i += 1) {
      const index = (j + 1) * side + (i + 1);
      worldOf(i, j, point);
      worldOf(i + 1, j, east);
      worldOf(i - 1, j, west);
      worldOf(i, j + 1, north);
      worldOf(i, j - 1, south);

      positions[index * 3] = point[0];
      positions[index * 3 + 1] = point[1];
      positions[index * 3 + 2] = point[2];
      ups[index * 3] = point[3];
      ups[index * 3 + 1] = point[4];
      ups[index * 3 + 2] = point[5];

      const ax = east[0] - west[0];
      const ay = east[1] - west[1];
      const az = east[2] - west[2];
      const bx = north[0] - south[0];
      const by = north[1] - south[1];
      const bz = north[2] - south[2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      if (nx * point[3] + ny * point[4] + nz * point[5] < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
      normals[index * 3] = nx;
      normals[index * 3 + 1] = ny;
      normals[index * 3 + 2] = nz;

      uvs[index * 2] = Math.max(0, Math.min(1, i / resolution));
      uvs[index * 2 + 1] = Math.max(0, Math.min(1, j / resolution));

      boundingRadius = Math.max(boundingRadius, Math.hypot(point[0], point[1], point[2]));
      if (i >= 0 && i <= resolution && j >= 0 && j <= resolution) {
        heights[j * (resolution + 1) + i] = heightGrid[(j + 2) * stride + (i + 2)];
      }
    }
  }

  const quads = resolution + 2;
  const indices = new Uint32Array(quads * quads * 6);
  let cursor = 0;
  for (let j = 0; j < quads; j += 1) {
    for (let i = 0; i < quads; i += 1) {
      const a = j * side + i;
      const b = a + 1;
      const c = a + side;
      const d = c + 1;
      indices[cursor] = a;
      indices[cursor + 1] = c;
      indices[cursor + 2] = b;
      indices[cursor + 3] = b;
      indices[cursor + 4] = c;
      indices[cursor + 5] = d;
      cursor += 6;
    }
  }

  const texture = imagery ? buildTexture(job, imagery, job.textureSize) : null;
  const textureSize = job.textureSize;

  return {
    type: 'built',
    id: job.id,
    positions,
    normals,
    ups,
    uvs,
    indices,
    heights,
    centre,
    boundingRadius,
    minH,
    maxH,
    texture,
    textureSize,
    source: elevation ? 'tiles' : 'procedural',
    textured: Boolean(texture),
    diagnostics,
  };
}

self.onmessage = async (event) => {
  const job = event.data;
  try {
    const result = await build(job);
    const transfer = [
      result.positions.buffer,
      result.normals.buffer,
      result.ups.buffer,
      result.uvs.buffer,
      result.indices.buffer,
      result.heights.buffer,
    ];
    if (result.texture) transfer.push(result.texture.buffer);
    self.postMessage(result, transfer);
  } catch (error) {
    self.postMessage({ type: 'failed', id: job.id, reason: String(error) });
  }
};
