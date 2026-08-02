// The ship in the scene: the Blender hull, its engine glow, and the camera that rides
// inside it. Everything is placed from the float64 ship state each frame, so the model
// never carries a coordinate big enough to shake.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { vec3, add, sub, copy } from '../shared/vec3.js';
import { rotateVector } from '../shared/quat.js';
import { SHIP } from './flight.js';

// The eye sits just ahead of the nose glass. There is no cabin geometry to sit inside
// yet - phase 3 builds it - and a pilot buried in an unlit hull sees nothing but the far
// wall of their own ship.
export const COCKPIT = { x: 0, y: 3.6, z: -63 };
export const CHASE = { x: 0, y: 26, z: 128 };
// The GLB is the HULL only: 100 m. The glazed bridge module in interior.glb adds the
// rest of the ship's 120 m at the front.
const EXPECTED_LENGTH = 100;

export class ShipView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.model = null;
    this.glow = [];

    // Nothing in this scene was lit until now: the planet does its own shading in a
    // shader, so the ship arrived from Blender with standard materials and no light to
    // stand in. The sun lights the hull from outside, deck lamps ride along inside.
    this.sunLight = new THREE.DirectionalLight(0xfff4e2, 2.6);
    this.sunLight.position.set(1, 0, 0);
    scene.add(this.sunLight);
    scene.add(new THREE.AmbientLight(0x1a2230, 0.5));
    for (const z of [-52, -34, -18, 0, 14, 30]) {
      const lamp = new THREE.PointLight(0xbcd8ff, 26, 26, 2);
      lamp.position.set(0, 2.9, z);
      this.group.add(lamp);
    }
    this.group.add(new THREE.PointLight(0xbcd8ff, 18, 20, 2).translateY(6.6).translateZ(-13));
    this.ready = false;
    this.warning = null;
    this.quaternion = new THREE.Quaternion();
    this.eye = vec3();
    this.offset = vec3();

    const loader = new GLTFLoader();
    loader.load(
      'assets/ship.glb',
      (gltf) => this.accept(gltf.scene),
      undefined,
      () => {
        this.warning = 'ship.glb failed to load, flying the placeholder';
        this.accept(this.placeholder());
      }
    );
    loader.load('assets/interior.glb', (gltf) => {
      gltf.scene.traverse((child) => {
        if (child.isMesh) child.frustumCulled = false;
      });
      this.interior = gltf.scene;
      this.group.add(gltf.scene);
    });
  }

  placeholder() {
    const group = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.CapsuleGeometry(9, 90, 4, 12),
      new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.5, metalness: 0.3 })
    );
    hull.rotation.x = Math.PI / 2;
    group.add(hull);
    return group;
  }

  // Size control at load, the same rule as every other model in these projects: a hull
  // that does not match the length the flight model assumes is not drawn silently at the
  // wrong scale, it is reported.
  accept(root) {
    const box = new THREE.Box3().setFromObject(root);
    const size = new THREE.Vector3();
    box.getSize(size);
    const length = size.z;
    if (Math.abs(length - EXPECTED_LENGTH) > EXPECTED_LENGTH * 0.05) {
      this.warning = `ship model is ${length.toFixed(1)} m, expected ${EXPECTED_LENGTH} m`;
      root.scale.setScalar(EXPECTED_LENGTH / length);
    }
    root.traverse((child) => {
      if (!child.isMesh) return;
      child.frustumCulled = false;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material.emissive && material.emissiveIntensity > 0) this.glow.push(material);
      }
    });
    this.model = root;
    this.group.add(root);
    this.ready = true;
    this.measured = { length, width: size.x, height: size.y };
  }

  // The eye sits in the cockpit, the chase camera hangs behind and above. Both are
  // expressed in ship space and rotated by the ship, so looking around never moves the
  // ship and flying never moves the head.
  cameraOrigin(ship, bodyPosition, local, out = vec3()) {
    rotateVector(this.offset, local, ship.orientation);
    add(out, ship.position, this.offset);
    add(out, out, bodyPosition);
    return out;
  }

  // The hull used to be hidden whenever the camera was aboard, because the nose closed
  // over the bridge and the pilot faced the inside of their own ship. The nose is open
  // now, so the ship stays visible from every seat - which is the point of having one.
  update(ship, cameraOrigin, bodyPosition, throttle, sunDirection) {
    if (sunDirection) this.sunLight.position.set(sunDirection.x * 1000, sunDirection.y * 1000, sunDirection.z * 1000);
    if (!this.ready) return;
    add(this.eye, ship.position, bodyPosition);
    sub(this.eye, this.eye, cameraOrigin);
    this.group.position.set(this.eye.x, this.eye.y, this.eye.z);
    this.quaternion.set(ship.orientation.x, ship.orientation.y, ship.orientation.z, ship.orientation.w);
    this.group.quaternion.copy(this.quaternion);
    for (const material of this.glow) {
      material.emissiveIntensity = 0.35 + throttle * 5.5;
    }
  }
}
