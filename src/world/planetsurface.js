// Owns the terrain and the air of whichever body the crew is currently near. Only one
// body is ever close at 1:1 scale, so only one surface exists at a time and switching
// bodies frees everything the previous one held.

import { Terrain, WorkerPool } from './terrain.js';
import { Atmosphere } from './atmosphere.js';
import { BODIES } from '../shared/bodies.js';

const AIR = {
  earth: { height: 110000, tint: [0.28, 0.47, 0.92], density: 1.5 },
  mars: { height: 70000, tint: [0.78, 0.55, 0.38], density: 0.42 },
};

export class PlanetSurface {
  constructor(scene) {
    this.scene = scene;
    this.pool = new WorkerPool(3);
    this.bodyId = null;
    this.terrain = null;
    this.atmosphere = null;
    this.stats = { patches: 0, loaded: 0, inflight: 0 };
  }

  attach(bodyId) {
    if (this.bodyId === bodyId) return;
    this.detach();
    if (!bodyId) return;
    const body = BODIES[bodyId];
    this.bodyId = bodyId;
    this.terrain = new Terrain(bodyId, body.radius, this.scene, this.pool);
    const air = AIR[bodyId];
    if (air) this.atmosphere = new Atmosphere(this.scene, body.radius, air.height, air.tint, air.density);
  }

  detach() {
    if (this.terrain) this.terrain.dispose();
    if (this.atmosphere) this.atmosphere.dispose();
    this.terrain = null;
    this.atmosphere = null;
    this.bodyId = null;
    this.stats = { patches: 0, loaded: 0, inflight: 0 };
  }

  update(bodyId, planetPosition, planetQuaternion, camera, sunDirection) {
    this.attach(bodyId);
    if (!this.terrain) return this.stats;
    this.stats = this.terrain.update(camera, planetPosition, planetQuaternion, sunDirection);
    if (this.atmosphere) this.atmosphere.update(this.terrain.planetOffset, sunDirection);
    return this.stats;
  }

  setCraters(craters) {
    if (this.terrain) this.terrain.craters = craters;
  }

  invalidate(direction, angularRadius) {
    if (this.terrain) this.terrain.invalidate(direction, angularRadius);
  }

  heightAt(direction) {
    if (!this.terrain) return 0;
    return this.terrain.sampleHeight(direction);
  }
}
