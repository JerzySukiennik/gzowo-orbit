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
const CHASE = { x: 0, y: 26, z: 128 };
const EXPECTED_LENGTH = 120;

export class ShipView {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);
    this.model = null;
    this.glow = [];
    this.ready = false;
    this.warning = null;
    this.quaternion = new THREE.Quaternion();
    this.eye = vec3();
    this.offset = vec3();

    new GLTFLoader().load(
      'assets/ship.glb',
      (gltf) => this.accept(gltf.scene),
      undefined,
      () => {
        this.warning = 'ship.glb failed to load, flying the placeholder';
        this.accept(this.placeholder());
      }
    );
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
  cameraOrigin(ship, bodyPosition, third, out = vec3()) {
    const local = third ? CHASE : COCKPIT;
    rotateVector(this.offset, local, ship.orientation);
    add(out, ship.position, this.offset);
    add(out, out, bodyPosition);
    return out;
  }

  update(ship, cameraOrigin, bodyPosition, throttle) {
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
