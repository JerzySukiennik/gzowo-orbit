// Three render passes sharing one orientation: stars, compressed far bodies, true-scale
// near geometry. Each pass gets its own depth range because no single depth buffer
// survives a scene that spans from a bootprint to Mars.

import * as THREE from 'three';
import { NEAR_FAR_PLANE, FAR_NEAR_PLANE, FAR_FAR_PLANE } from '../shared/frame.js';

const FOV = 55;

export class LayeredRenderer {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.renderer.info.autoReset = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.starScene = new THREE.Scene();
    this.farScene = new THREE.Scene();
    this.nearScene = new THREE.Scene();

    this.starCamera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 20);
    this.farCamera = new THREE.PerspectiveCamera(FOV, 1, FAR_NEAR_PLANE, FAR_FAR_PLANE);
    this.nearCamera = new THREE.PerspectiveCamera(FOV, 1, 0.05, NEAR_FAR_PLANE);

    this.cameras = [this.starCamera, this.farCamera, this.nearCamera];
    this.pixelRatioCap = 1.5;
    this.resize();
  }

  resize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const ratio = Math.min(window.devicePixelRatio || 1, this.pixelRatioCap);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    for (const camera of this.cameras) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
  }

  setQuality(pixelRatioCap) {
    this.pixelRatioCap = pixelRatioCap;
    this.resize();
  }

  render(orientation) {
    for (const camera of this.cameras) {
      camera.quaternion.copy(orientation);
      camera.position.set(0, 0, 0);
      camera.updateMatrixWorld();
    }

    this.renderer.info.reset();
    this.renderer.clear(true, true, true);
    this.renderer.render(this.starScene, this.starCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.farScene, this.farCamera);
    this.renderer.clearDepth();
    this.renderer.render(this.nearScene, this.nearCamera);
  }

  get info() {
    return this.renderer.info.render;
  }
}
