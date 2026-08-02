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

  takeMouse() {
    const dx = (this.stickX || 0) * 0.0022;
    const dy = (this.stickY || 0) * 0.0022;
    this.stickX = 0;
    this.stickY = 0;
    return { dx, dy };
  }

  walkInput() {
    return {
      forward: (this.held('KeyW') ? 1 : 0) - (this.held('KeyS') ? 1 : 0),
      strafe: (this.held('KeyD') ? 1 : 0) - (this.held('KeyA') ? 1 : 0),
      vertical: (this.held('Space') ? 1 : 0) - (this.held('ControlLeft') || this.held('ControlRight') ? 1 : 0),
      run: this.held('ShiftLeft') || this.held('ShiftRight'),
    };
  }

  // Mouse movement is a rate command on the control axes rather than an absolute
  // position: there is no air to centre a stick against in vacuum, so the ship holds
  // whatever rotation you last gave it until you stop it.
  sample(dt, mouse) {
    const pitch = Math.max(-1, Math.min(1, mouse.dy * 9));
    const yaw = Math.max(-1, Math.min(1, -mouse.dx * 9));

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

  // Orientation from a look direction and a local up, for anyone standing on a sphere:
  // there is no fixed world "up" once you can walk to the other side of a planet.
  lookOrientation(forward, up) {
    if (!this.lookMatrix) {
      this.lookMatrix = new THREE.Matrix4();
      this.lookTarget = new THREE.Vector3();
      this.lookUp = new THREE.Vector3();
      this.lookZero = new THREE.Vector3();
    }
    this.lookTarget.set(forward.x, forward.y, forward.z).normalize();
    this.lookUp.set(up.x, up.y, up.z).normalize();
    this.lookMatrix.lookAt(this.lookZero, this.lookTarget, this.lookUp);
    return this.orientation.setFromRotationMatrix(this.lookMatrix);
  }

  crewOrientation(shipOrientation, yaw, pitch) {
    this.shipQuaternion.set(shipOrientation.x, shipOrientation.y, shipOrientation.z, shipOrientation.w);
    this.euler.set(pitch, yaw, 0, 'YXZ');
    this.headQuaternion.setFromEuler(this.euler);
    return this.orientation.copy(this.shipQuaternion).multiply(this.headQuaternion);
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
