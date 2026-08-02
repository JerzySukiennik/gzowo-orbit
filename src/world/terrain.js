// Cube-sphere quadtree terrain: six root faces, split by screen-relative size, built in
// workers, drawn at true scale in the near pass.
//
// Two rules keep it honest at 1:1. A node is only replaced by its children once ALL FOUR
// are ready, so splitting never opens a hole. And every patch mesh is positioned as
// (patch centre in world) minus (camera in world) computed in float64 each frame - the
// vertices themselves are local to the patch, so the matrix that reaches the GPU never
// carries a number big enough to shake.

import * as THREE from 'three';
import { faceUvToDirection, directionToFaceUv } from '../shared/geodesy.js';
import { proceduralHeight, detailHeight } from '../shared/terrainheight.js';

const RESOLUTION = 32;
const SPLIT_FACTOR = 2.4;
const MAX_INFLIGHT = 6;
const RETIRE_AFTER = 240;
const PATCH_BUDGET = 420;

const MAX_LEVEL = { earth: 16, moon: 15, mars: 15 };

const PALETTE = {
  moon: { low: [0.24, 0.23, 0.22], high: [0.55, 0.54, 0.52], slope: [0.35, 0.34, 0.33] },
  mars: { low: [0.42, 0.19, 0.11], high: [0.74, 0.45, 0.28], slope: [0.3, 0.16, 0.12] },
  earth: { low: [0.18, 0.22, 0.14], high: [0.7, 0.68, 0.64], slope: [0.32, 0.28, 0.24] },
};

const vertexHead = `
  attribute vec3 aUp;
  uniform vec3 uCentre;
  uniform float uRadius;
  varying vec3 vNormalW;
  varying vec3 vUpW;
  varying float vHeight;
  varying float vViewDepth;
`;

const vertexBody = `
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vUpW = normalize(mat3(modelMatrix) * aUp);
  vHeight = length(position + uCentre) - uRadius;
  vViewDepth = -(viewMatrix * modelMatrix * vec4(position, 1.0)).z;
`;

const fragmentHead = `
  uniform bool uHasMap;
  uniform vec3 uSunDir;
  uniform vec3 uLow;
  uniform vec3 uHigh;
  uniform vec3 uSlopeColour;
  uniform float uRelief;
  uniform float uAmbient;
  varying vec3 vNormalW;
  varying vec3 vUpW;
  varying float vHeight;
  varying float vViewDepth;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  float noise(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y),
      f.z);
  }
`;

const fragmentBody = `
  {
    vec3 n = normalize(vNormalW);
    vec3 up = normalize(vUpW);
    float slope = 1.0 - clamp(dot(n, up), 0.0, 1.0);
    float grain = noise(up * 90000.0);
    float mottle = noise(up * 5200.0) * 0.5 + noise(up * 24000.0) * 0.5;

    vec3 base = diffuseColor.rgb;
    if (uHasMap) {
      base = mix(base, base * (0.72 + mottle * 0.55), clamp(1.0 - vViewDepth / 90000.0, 0.0, 0.85));
      base = mix(base, uSlopeColour, smoothstep(0.35, 0.75, slope) * 0.7);
    } else {
      float band = clamp(vHeight / uRelief * 0.5 + 0.5, 0.0, 1.0);
      base = mix(uLow, uHigh, smoothstep(0.25, 0.85, band + mottle * 0.22));
      base = mix(base, uSlopeColour, smoothstep(0.25, 0.7, slope));
      base *= 0.86 + mottle * 0.28;
    }
    base *= 0.94 + grain * 0.12;

    float terminator = smoothstep(-0.05, 0.12, dot(up, uSunDir));
    float lambert = max(dot(n, uSunDir), 0.0);
    diffuseColor.rgb = base * (uAmbient + lambert * terminator * 1.35);
  }
`;

function rotate(out, v, q) {
  const { x, y, z } = v;
  const ix = q.w * x + q.y * z - q.z * y;
  const iy = q.w * y + q.z * x - q.x * z;
  const iz = q.w * z + q.x * y - q.y * x;
  const iw = -q.x * x - q.y * y - q.z * z;
  out.x = ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y;
  out.y = iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z;
  out.z = iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x;
  return out;
}

export class WorkerPool {
  constructor(size = 2) {
    this.workers = [];
    this.handlers = new Map();
    this.next = 0;
    this.inflight = 0;
    for (let i = 0; i < size; i += 1) {
      const worker = new Worker(new URL('./patchworker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (event) => {
        const handler = this.handlers.get(event.data.id);
        this.handlers.delete(event.data.id);
        this.inflight -= 1;
        if (handler) handler(event.data);
      };
      this.workers.push(worker);
    }
  }

  get busy() {
    return this.inflight >= MAX_INFLIGHT;
  }

  submit(job, handler) {
    this.handlers.set(job.id, handler);
    this.inflight += 1;
    const worker = this.workers[this.next % this.workers.length];
    this.next += 1;
    worker.postMessage(job);
  }

  dispose() {
    for (const worker of this.workers) worker.terminate();
    this.workers.length = 0;
  }
}

let nextJobId = 1;

class Node {
  constructor(terrain, face, u0, u1, v0, v1, level) {
    this.terrain = terrain;
    this.face = face;
    this.u0 = u0;
    this.u1 = u1;
    this.v0 = v0;
    this.v1 = v1;
    this.level = level;
    this.children = null;
    this.mesh = null;
    this.heights = null;
    this.state = 'idle';
    this.lastUsed = 0;
    this.centreDirection = faceUvToDirection(face, (u0 + u1) / 2, (v0 + v1) / 2);
    this.arc = (Math.abs(u1 - u0) / 2) * (Math.PI / 2) * terrain.radius;
    this.midHeight = 0;
    this.boundingRadius = this.arc;
  }

  get ready() {
    return this.mesh !== null;
  }

  request() {
    if (this.state !== 'idle' || this.terrain.pool.busy) return;
    this.state = 'pending';
    const id = nextJobId += 1;
    this.terrain.pool.submit(
      {
        id,
        body: this.terrain.bodyId,
        radius: this.terrain.radius,
        face: this.face,
        u0: this.u0,
        u1: this.u1,
        v0: this.v0,
        v1: this.v1,
        level: this.level,
        resolution: RESOLUTION,
        textureSize: this.level <= 8 ? 96 : 128,
        useTiles: this.terrain.useTiles,
      },
      (payload) => this.receive(payload)
    );
  }

  receive(payload) {
    if (payload.type !== 'built' || this.disposed) {
      this.state = 'idle';
      return;
    }
    this.terrain.lastDiagnostics = payload.diagnostics;
    this.terrain.sources[payload.source] = (this.terrain.sources[payload.source] || 0) + 1;
    this.mesh = this.terrain.createMesh(payload);
    this.heights = payload.heights;
    this.centreLocal = payload.centre;
    this.boundingRadius = payload.boundingRadius;
    this.midHeight = (payload.minH + payload.maxH) / 2;
    this.state = 'ready';
    this.terrain.patchCount += 1;
  }

  ensureChildren() {
    if (this.children) return;
    const um = (this.u0 + this.u1) / 2;
    const vm = (this.v0 + this.v1) / 2;
    this.children = [
      new Node(this.terrain, this.face, this.u0, um, this.v0, vm, this.level + 1),
      new Node(this.terrain, this.face, um, this.u1, this.v0, vm, this.level + 1),
      new Node(this.terrain, this.face, this.u0, um, vm, this.v1, this.level + 1),
      new Node(this.terrain, this.face, um, this.u1, vm, this.v1, this.level + 1),
    ];
  }

  dropChildren(frame) {
    if (!this.children) return;
    let recentlyUsed = false;
    for (const child of this.children) {
      child.dropChildren(frame);
      if (frame - child.lastUsed < RETIRE_AFTER) recentlyUsed = true;
    }
    if (recentlyUsed) return;
    for (const child of this.children) child.dispose();
    this.children = null;
  }

  dispose() {
    this.disposed = true;
    if (this.children) for (const child of this.children) child.dispose();
    this.children = null;
    if (this.mesh) {
      this.terrain.destroyMesh(this.mesh);
      this.mesh = null;
      this.terrain.patchCount -= 1;
    }
    this.heights = null;
    this.state = 'idle';
  }
}

export class Terrain {
  constructor(bodyId, radius, scene, pool) {
    this.bodyId = bodyId;
    this.radius = radius;
    this.scene = scene;
    this.pool = pool;
    this.useTiles = bodyId === 'earth';
    this.maxLevel = MAX_LEVEL[bodyId] || 14;
    this.palette = PALETTE[bodyId] || PALETTE.moon;
    this.relief = bodyId === 'earth' ? 6000 : bodyId === 'mars' ? 9000 : 3000;
    this.patchCount = 0;
    this.frame = 0;
    this.sources = {};
    this.lastDiagnostics = null;
    this.visible = [];
    this.sunDirection = new THREE.Vector3(1, 0, 0);
    this.geometryCache = [];

    this.roots = [];
    for (let face = 0; face < 6; face += 1) {
      this.roots.push(new Node(this, face, -1, 1, -1, 1, 0));
    }

    this.scratchDirection = { x: 0, y: 0, z: 0 };
    this.scratchRotated = { x: 0, y: 0, z: 0 };
    this.faceUv = { face: 0, u: 0, v: 0 };
  }

  createMesh(payload) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(payload.positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(payload.normals, 3));
    geometry.setAttribute('aUp', new THREE.BufferAttribute(payload.ups, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(payload.uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(payload.indices, 1));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), payload.boundingRadius);

    let map = null;
    if (payload.texture) {
      map = new THREE.DataTexture(payload.texture, payload.textureSize, payload.textureSize, THREE.RGBAFormat);
      map.colorSpace = THREE.SRGBColorSpace;
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.magFilter = THREE.LinearFilter;
      map.wrapS = THREE.ClampToEdgeWrapping;
      map.wrapT = THREE.ClampToEdgeWrapping;
      map.generateMipmaps = true;
      map.anisotropy = 4;
      map.flipY = false;
      map.needsUpdate = true;
    }

    const material = new THREE.MeshBasicMaterial({ map });
    const extra = {
      uSunDir: { value: this.sunDirection },
      uCentre: { value: new THREE.Vector3(payload.centre[0], payload.centre[1], payload.centre[2]) },
      uRadius: { value: this.radius },
      uLow: { value: new THREE.Color().fromArray(this.palette.low) },
      uHigh: { value: new THREE.Color().fromArray(this.palette.high) },
      uSlopeColour: { value: new THREE.Color().fromArray(this.palette.slope) },
      uRelief: { value: this.relief },
      uAmbient: { value: 0.045 },
      uHasMap: { value: Boolean(map) },
    };
    material.userData.uniforms = extra;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, extra);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${vertexHead}`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vertexBody}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${fragmentHead}`)
        .replace('#include <map_fragment>', `#include <map_fragment>\n${fragmentBody}`);
    };

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = true;
    mesh.visible = false;
    this.scene.add(mesh);
    return mesh;
  }

  destroyMesh(mesh) {
    this.scene.remove(mesh);
    mesh.geometry.dispose();
    if (mesh.material.map) mesh.material.map.dispose();
    mesh.material.dispose();
  }

  nodeWorld(node, planetPosition, planetQuaternion, out) {
    const height = this.radius + node.midHeight;
    this.scratchDirection.x = node.centreDirection.x * height;
    this.scratchDirection.y = node.centreDirection.y * height;
    this.scratchDirection.z = node.centreDirection.z * height;
    rotate(out, this.scratchDirection, planetQuaternion);
    out.x += planetPosition.x;
    out.y += planetPosition.y;
    out.z += planetPosition.z;
    return out;
  }

  update(camera, planetPosition, planetQuaternion, sunDirection) {
    this.frame += 1;
    this.sunDirection.set(sunDirection.x, sunDirection.y, sunDirection.z);
    for (const mesh of this.visible) mesh.visible = false;
    this.visible.length = 0;

    this.planetOffset = {
      x: planetPosition.x - camera.x,
      y: planetPosition.y - camera.y,
      z: planetPosition.z - camera.z,
    };

    const world = { x: 0, y: 0, z: 0 };
    // fallback carries the deepest ancestor that actually has geometry. Without it a node
    // whose own mesh has not arrived yet leaves a hole straight through the planet, and
    // the hole lasts exactly as long as the build queue stays saturated.
    const visit = (node, fallback) => {
      node.lastUsed = this.frame;
      const drawable = node.ready ? node : fallback;
      this.nodeWorld(node, planetPosition, planetQuaternion, world);
      const distance = Math.max(
        1,
        Math.hypot(world.x - camera.x, world.y - camera.y, world.z - camera.z) - node.boundingRadius
      );

      const wantsSplit = node.level < this.maxLevel && distance < node.arc * SPLIT_FACTOR;
      if (!wantsSplit) {
        if (!node.ready) node.request();
        this.draw(drawable, planetQuaternion);
        node.dropChildren(this.frame);
        return;
      }

      node.ensureChildren();
      let allReady = true;
      for (const child of node.children) {
        child.lastUsed = this.frame;
        if (!child.ready) {
          allReady = false;
          child.request();
        }
      }
      if (!allReady) {
        if (!node.ready) node.request();
        this.draw(drawable, planetQuaternion);
        return;
      }
      for (const child of node.children) visit(child, drawable);
    };

    for (const root of this.roots) visit(root, null);

    if (this.patchCount > PATCH_BUDGET) {
      for (const root of this.roots) root.dropChildren(this.frame);
    }

    return { patches: this.visible.length, loaded: this.patchCount, inflight: this.pool.inflight };
  }

  draw(node, planetQuaternion) {
    if (!node || !node.ready || node.mesh.visible) return;
    const centre = node.centreLocal;
    this.scratchDirection.x = centre[0];
    this.scratchDirection.y = centre[1];
    this.scratchDirection.z = centre[2];
    rotate(this.scratchRotated, this.scratchDirection, planetQuaternion);
    node.mesh.position.set(
      this.scratchRotated.x + this.planetOffset.x,
      this.scratchRotated.y + this.planetOffset.y,
      this.scratchRotated.z + this.planetOffset.z
    );
    node.mesh.quaternion.copy(planetQuaternion);
    node.mesh.visible = true;
    this.visible.push(node.mesh);
  }

  sampleHeight(direction) {
    directionToFaceUv(direction, this.faceUv);
    let node = this.roots[this.faceUv.face];
    let best = null;
    while (node) {
      if (node.heights) best = node;
      if (!node.children) break;
      const um = (node.u0 + node.u1) / 2;
      const vm = (node.v0 + node.v1) / 2;
      const index = (this.faceUv.u > um ? 1 : 0) + (this.faceUv.v > vm ? 2 : 0);
      node = node.children[index];
    }
    if (!best) {
      return proceduralHeight(this.bodyId, direction, this.radius) + detailHeight(this.bodyId, direction);
    }

    const fx = ((this.faceUv.u - best.u0) / (best.u1 - best.u0)) * RESOLUTION;
    const fy = ((this.faceUv.v - best.v0) / (best.v1 - best.v0)) * RESOLUTION;
    const x = Math.max(0, Math.min(RESOLUTION - 1e-6, fx));
    const y = Math.max(0, Math.min(RESOLUTION - 1e-6, fy));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const stride = RESOLUTION + 1;
    const h00 = best.heights[y0 * stride + x0];
    const h10 = best.heights[y0 * stride + x0 + 1];
    const h01 = best.heights[(y0 + 1) * stride + x0];
    const h11 = best.heights[(y0 + 1) * stride + x0 + 1];
    return (h00 + (h10 - h00) * tx) * (1 - ty) + (h01 + (h11 - h01) * tx) * ty;
  }

  dispose() {
    for (const root of this.roots) root.dispose();
    this.roots.length = 0;
    this.visible.length = 0;
  }
}
