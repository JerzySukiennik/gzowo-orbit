// Pilot input and the camera that rides with it. Full six degrees of freedom, no
// assistance beyond a stabiliser you have to hold down yourself.

import * as THREE from 'three';
import { quat } from '../shared/quat.js';

const LOOK_SENSITIVITY = 0.0016;
const HEAD_LIMIT = 1.15;
const THROTTLE_RATE = 0.65;

export class Pilot {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.locked = false;
    this.third = false;
    this.headYaw = 0;
    this.headPitch = 0;
    this.mainThrottle = 0;
    this.liftThrottle = 0;
    this.orientation = new THREE.Quaternion();
    this.shipQuaternion = new THREE.Quaternion();
    this.headQuaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');

    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.locked) return;
      if (this.keys.has('AltLeft') || this.keys.has('AltRight')) {
        this.headYaw = Math.max(-Math.PI, Math.min(Math.PI, this.headYaw - event.movementX * LOOK_SENSITIVITY));
        this.headPitch = Math.max(-HEAD_LIMIT, Math.min(HEAD_LIMIT, this.headPitch - event.movementY * LOOK_SENSITIVITY));
        return;
      }
      this.stickX = (this.stickX || 0) + event.movementX;
      this.stickY = (this.stickY || 0) + event.movementY;
    });
    window.addEventListener('keydown', (event) => {
      this.keys.add(event.code);
      if (event.code === 'KeyV') this.third = !this.third;
      if (event.code === 'KeyH') {
        this.headYaw = 0;
        this.headPitch = 0;
      }
      if (['Space', 'KeyW', 'KeyS'].includes(event.code)) event.preventDefault();
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  held(code) {
    return this.keys.has(code);
  }

  // Mouse movement is a rate command on the control axes rather than an absolute
  // position: there is no air to centre a stick against in vacuum, so the ship holds
  // whatever rotation you last gave it until you stop it.
  sample(dt) {
    const pitch = Math.max(-1, Math.min(1, (this.stickY || 0) * 0.02));
    const yaw = Math.max(-1, Math.min(1, -(this.stickX || 0) * 0.02));
    this.stickX = 0;
    this.stickY = 0;

    const mainUp = this.held('KeyW') ? 1 : 0;
    const mainDown = this.held('KeyS') ? 1 : 0;
    this.mainThrottle = Math.max(0, Math.min(1, this.mainThrottle + (mainUp - mainDown) * THROTTLE_RATE * dt));
    const liftUp = this.held('ShiftLeft') || this.held('ShiftRight') ? 1 : 0;
    const liftDown = this.held('ControlLeft') || this.held('ControlRight') ? 1 : 0;
    this.liftThrottle = Math.max(0, Math.min(1, this.liftThrottle + (liftUp - liftDown) * THROTTLE_RATE * dt));
    if (this.held('KeyX')) {
      this.mainThrottle = 0;
      this.liftThrottle = 0;
    }

    return {
      pitch,
      yaw,
      roll: (this.held('KeyQ') ? 1 : 0) - (this.held('KeyE') ? 1 : 0),
      main: this.mainThrottle,
      lift: this.liftThrottle,
      strafe: (this.held('KeyD') ? 1 : 0) - (this.held('KeyA') ? 1 : 0),
      vertical: (this.held('KeyR') ? 1 : 0) - (this.held('KeyF') ? 1 : 0),
      brake: this.held('Space'),
      gear: this.gear !== false,
    };
  }

  toggleGear() {
    this.gear = this.gear === false;
  }

  cameraOrientation(shipOrientation) {
    this.shipQuaternion.set(shipOrientation.x, shipOrientation.y, shipOrientation.z, shipOrientation.w);
    this.euler.set(this.headPitch, this.headYaw, 0, 'YXZ');
    this.headQuaternion.setFromEuler(this.euler);
    this.orientation.copy(this.shipQuaternion).multiply(this.headQuaternion);
    if (this.third) {
      this.euler.set(0, Math.PI, 0, 'YXZ');
      this.headQuaternion.setFromEuler(this.euler);
      this.orientation.copy(this.shipQuaternion);
    }
    return this.orientation;
  }
}
