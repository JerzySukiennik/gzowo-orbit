// Free-flight observer used until the ship arrives in phase 2.
//
// Its position is stored RELATIVE TO A BODY, never absolute. Mars travels 24 km/s and
// the environment clock multiplies that further, so anything anchored to the Sun is
// left behind within a frame. Every moving thing in this game carries a reference frame.

import * as THREE from 'three';
import { vec3, addScaled, add, set, copy } from '../shared/vec3.js';
import { BODIES } from '../shared/bodies.js';

const MIN_SPEED = 1;
const MAX_SPEED = 3e8;
const LOOK_SENSITIVITY = 0.0022;
const ROLL_RATE = 1.4;

export class Observer {
  constructor(canvas) {
    this.canvas = canvas;
    this.frame = 'earth';
    this.local = vec3();
    this.world = vec3();
    this.quaternion = new THREE.Quaternion();
    this.cruiseSpeed = 20000;
    this.speed = 0;
    this.locked = false;
    this.keys = new Set();

    this.forward = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.up = new THREE.Vector3();
    this.delta = new THREE.Quaternion();
    this.axis = new THREE.Vector3();
    this.motion = vec3();

    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      this.applyLook(-event.movementX * LOOK_SENSITIVITY, -event.movementY * LOOK_SENSITIVITY);
    });
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.code === 'Space') event.preventDefault();
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
    window.addEventListener(
      'wheel',
      (event) => {
        const factor = event.deltaY < 0 ? 1.35 : 1 / 1.35;
        this.cruiseSpeed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, this.cruiseSpeed * factor));
      },
      { passive: true }
    );
  }

  applyLook(yaw, pitch) {
    this.axis.set(0, 1, 0).applyQuaternion(this.quaternion);
    this.delta.setFromAxisAngle(this.axis, yaw);
    this.quaternion.premultiply(this.delta);
    this.axis.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.delta.setFromAxisAngle(this.axis, pitch);
    this.quaternion.premultiply(this.delta);
    this.quaternion.normalize();
  }

  applyRoll(amount) {
    this.axis.set(0, 0, 1).applyQuaternion(this.quaternion);
    this.delta.setFromAxisAngle(this.axis, amount);
    this.quaternion.premultiply(this.delta);
    this.quaternion.normalize();
  }

  warpTo(bodyId, sunDirection) {
    const body = BODIES[bodyId];
    const range = body.radius * 3.2;
    this.frame = bodyId;

    const sunward = new THREE.Vector3(sunDirection.x, sunDirection.y, sunDirection.z).normalize();
    const side = new THREE.Vector3(0, 1, 0).cross(sunward).normalize();
    if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
    const up = new THREE.Vector3().crossVectors(sunward, side).normalize();
    const spot = sunward.clone().multiplyScalar(0.72).addScaledVector(side, 0.62).addScaledVector(up, 0.3).normalize();

    set(this.local, spot.x * range, spot.y * range, spot.z * range);
    const look = new THREE.Matrix4().lookAt(
      spot.clone().multiplyScalar(range),
      new THREE.Vector3(0, 0, 0),
      up
    );
    this.quaternion.setFromRotationMatrix(look);
    this.cruiseSpeed = Math.max(2000, body.radius / 25);
  }

  orientTo(forward, up) {
    const target = new THREE.Vector3(forward.x, forward.y, forward.z).normalize();
    const upVector = new THREE.Vector3(up.x, up.y, up.z).normalize();
    const matrix = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), target, upVector);
    this.quaternion.setFromRotationMatrix(matrix);
  }

  update(dt) {
    this.forward.set(0, 0, -1).applyQuaternion(this.quaternion);
    this.right.set(1, 0, 0).applyQuaternion(this.quaternion);
    this.up.set(0, 1, 0).applyQuaternion(this.quaternion);

    if (this.keys.has('KeyQ')) this.applyRoll(ROLL_RATE * dt);
    if (this.keys.has('KeyE')) this.applyRoll(-ROLL_RATE * dt);

    set(this.motion, 0, 0, 0);
    const push = (vector, sign) => {
      this.motion.x += vector.x * sign;
      this.motion.y += vector.y * sign;
      this.motion.z += vector.z * sign;
    };
    if (this.keys.has('KeyW')) push(this.forward, 1);
    if (this.keys.has('KeyS')) push(this.forward, -1);
    if (this.keys.has('KeyD')) push(this.right, 1);
    if (this.keys.has('KeyA')) push(this.right, -1);
    if (this.keys.has('KeyR')) push(this.up, 1);
    if (this.keys.has('KeyF')) push(this.up, -1);

    const magnitude = Math.hypot(this.motion.x, this.motion.y, this.motion.z);
    if (magnitude === 0) {
      this.speed = 0;
      return;
    }

    let speed = this.cruiseSpeed;
    if (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight')) speed *= 12;
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) speed /= 12;
    this.speed = speed;

    addScaled(this.local, this.local, this.motion, (speed * dt) / magnitude);
  }

  worldPosition(framePosition, out = this.world) {
    return add(out, framePosition, this.local);
  }

  copyLocal(out) {
    return copy(out, this.local);
  }
}
