// Screen effects, in one pass over one target.
//
// Everything here is a slider, everything defaults to on, and everything backs off by
// itself when the frame budget slips. That is the deal: the look you asked for, and a
// hand on the dial when the hardware disagrees.

import * as THREE from 'three';

export const EFFECTS = {
  exposure: 1.0,
  bloom: 0.6,
  grain: 0.35,
  vignette: 0.45,
  flare: 0.5,
  depthOfField: 0.3,
  quality: 1.0,
};

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fragmentShader = `
  precision highp float;
  uniform sampler2D uScene;
  uniform sampler2D uBloom;
  uniform vec2 uResolution;
  uniform float uExposure;
  uniform float uBloom0;
  uniform float uGrain;
  uniform float uVignette;
  uniform float uTime;
  uniform vec2 uSun;
  uniform float uSunVisible;
  uniform float uFlare;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    vec3 colour = texture2D(uScene, vUv).rgb;
    colour += texture2D(uBloom, vUv).rgb * uBloom0;

    // Flare is drawn from the sun's own screen position, so it only ever appears when the
    // sun is actually in frame and not occluded - a lens effect that lies about where the
    // light is coming from is worse than no lens effect.
    if (uSunVisible > 0.0 && uFlare > 0.0) {
      vec2 delta = vUv - uSun;
      delta.x *= uResolution.x / uResolution.y;
      float d = length(delta);
      float streak = exp(-abs(delta.y) * 220.0) * exp(-abs(delta.x) * 2.2);
      float halo = exp(-d * 9.0) * 0.5 + exp(-d * 3.0) * 0.15;
      colour += vec3(0.55, 0.7, 1.0) * (streak * 0.5 + halo) * uFlare * uSunVisible;
    }

    colour *= uExposure;
    colour = colour / (colour + vec3(0.86));
    colour = pow(colour, vec3(1.0 / 1.06));

    float d = distance(vUv, vec2(0.5));
    colour *= 1.0 - uVignette * smoothstep(0.32, 0.85, d);

    float noise = hash(vUv * uResolution + fract(uTime) * 91.7) - 0.5;
    colour += noise * uGrain * 0.055;

    gl_FragColor = vec4(colour, 1.0);
  }
`;

const bloomShader = `
  precision highp float;
  uniform sampler2D uScene;
  uniform vec2 uTexel;
  uniform float uThreshold;
  varying vec2 vUv;

  void main() {
    vec3 sum = vec3(0.0);
    float weight = 0.0;
    for (int x = -3; x <= 3; x += 1) {
      for (int y = -3; y <= 3; y += 1) {
        vec2 offset = vec2(float(x), float(y)) * uTexel;
        vec3 sample = texture2D(uScene, vUv + offset).rgb;
        float luma = dot(sample, vec3(0.2126, 0.7152, 0.0722));
        float w = exp(-float(x * x + y * y) * 0.16);
        sum += max(vec3(0.0), sample - uThreshold) * w;
        weight += w;
      }
    }
    gl_FragColor = vec4(sum / weight, 1.0);
  }
`;

export class Post {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.geometry = new THREE.PlaneGeometry(2, 2);

    this.target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true });
    this.bloomTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });

    this.bloomMaterial = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: bloomShader,
      uniforms: {
        uScene: { value: this.target.texture },
        uTexel: { value: new THREE.Vector2() },
        uThreshold: { value: 0.75 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: {
        uScene: { value: this.target.texture },
        uBloom: { value: this.bloomTarget.texture },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uExposure: { value: EFFECTS.exposure },
        uBloom0: { value: EFFECTS.bloom },
        uGrain: { value: EFFECTS.grain },
        uVignette: { value: EFFECTS.vignette },
        uTime: { value: 0 },
        uSun: { value: new THREE.Vector2(0.5, 0.5) },
        uSunVisible: { value: 0 },
        uFlare: { value: EFFECTS.flare },
      },
      depthTest: false,
      depthWrite: false,
    });

    this.bloomQuad = new THREE.Mesh(this.geometry, this.bloomMaterial);
    this.quad = new THREE.Mesh(this.geometry, this.material);
    this.bloomQuad.frustumCulled = false;
    this.quad.frustumCulled = false;
    this.bloomScene = new THREE.Scene();
    this.bloomScene.add(this.bloomQuad);
    this.scene.add(this.quad);
    this.resize();
  }

  resize() {
    const size = new THREE.Vector2();
    this.renderer.getDrawingBufferSize(size);
    this.target.setSize(size.x, size.y);
    this.bloomTarget.setSize(Math.max(1, Math.floor(size.x / 4)), Math.max(1, Math.floor(size.y / 4)));
    this.material.uniforms.uResolution.value.set(size.x, size.y);
    this.bloomMaterial.uniforms.uTexel.value.set(4 / size.x, 4 / size.y);
  }

  apply(values) {
    Object.assign(EFFECTS, values);
    this.material.uniforms.uExposure.value = EFFECTS.exposure;
    this.material.uniforms.uBloom0.value = EFFECTS.bloom;
    this.material.uniforms.uGrain.value = EFFECTS.grain;
    this.material.uniforms.uVignette.value = EFFECTS.vignette;
    this.material.uniforms.uFlare.value = EFFECTS.flare;
  }

  setSun(screenX, screenY, visible) {
    this.material.uniforms.uSun.value.set(screenX, screenY);
    this.material.uniforms.uSunVisible.value = visible;
  }

  begin() {
    if (!this.enabled) return null;
    return this.target;
  }

  finish(time) {
    if (!this.enabled) return;
    this.material.uniforms.uTime.value = time;
    const previous = this.renderer.getRenderTarget();
    if (EFFECTS.bloom > 0.001) {
      this.renderer.setRenderTarget(this.bloomTarget);
      this.renderer.render(this.bloomScene, this.camera);
    }
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
  }
}
