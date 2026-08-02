// Procedural starfield. Nothing to download, nothing that visibly tiles. Drawn in its
// own pass at unit distance, so it is always behind everything and never clipped.

import * as THREE from 'three';

const STAR_COUNT = 5200;
const SHELL = 8;

function hash(n) {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

export function createStarfield() {
  const positions = new Float32Array(STAR_COUNT * 3);
  const colours = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const colour = new THREE.Color();

  for (let i = 0; i < STAR_COUNT; i += 1) {
    const u = hash(i + 1) * 2 - 1;
    const theta = hash(i + 7.3) * Math.PI * 2;
    const r = Math.sqrt(1 - u * u);
    positions[i * 3] = r * Math.cos(theta) * SHELL;
    positions[i * 3 + 1] = u * SHELL;
    positions[i * 3 + 2] = r * Math.sin(theta) * SHELL;

    const magnitude = Math.pow(hash(i + 19.7), 3.2);
    const temperature = hash(i + 31.4);
    colour.setHSL(0.08 + temperature * 0.55, 0.35 - temperature * 0.2, 0.55 + magnitude * 0.45);
    colours[i * 3] = colour.r;
    colours[i * 3 + 1] = colour.g;
    colours[i * 3 + 2] = colour.b;
    sizes[i] = 0.6 + magnitude * 2.6;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('colour', new THREE.BufferAttribute(colours, 3));
  geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    transparent: true,
    uniforms: { uScale: { value: 1 }, uStretch: { value: 0 } },
    vertexShader: `
      attribute vec3 colour;
      attribute float size;
      uniform float uScale;
      uniform float uStretch;
      varying vec3 vColour;
      varying float vStretch;
      void main() {
        vColour = mix(colour, vec3(0.62, 0.78, 1.0), uStretch * 0.7);
        vStretch = uStretch;
        vec4 view = viewMatrix * modelMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * view;
        gl_PointSize = size * uScale * (1.0 + uStretch * 9.0);
      }
    `,
    fragmentShader: `
      varying vec3 vColour;
      varying float vStretch;
      void main() {
        vec2 d = gl_PointCoord - vec2(0.5);
        // During a jump the stars smear along one axis. Same points, same positions, just
        // drawn as streaks - no second particle system to keep in step with the first.
        d.x /= mix(1.0, 0.13, vStretch);
        float falloff = 1.0 - smoothstep(0.0, 0.5, length(d));
        if (falloff <= 0.0) discard;
        gl_FragColor = vec4(vColour, falloff * falloff * (1.0 + vStretch));
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.setStretch = (amount) => {
    material.uniforms.uStretch.value = Math.max(0, Math.min(1, amount));
  };
  return points;
}
