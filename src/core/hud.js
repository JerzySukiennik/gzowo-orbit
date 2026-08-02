// Temporary flight-test readout. Phase 2 replaces it with the diegetic cockpit; nothing
// here survives past that, so it stays a plain overlay on purpose.

import { BODIES, BODY_IDS } from '../shared/bodies.js';
import { formatDistance, formatSpeed } from '../shared/units.js';
import { directionToLatLon, degrees } from '../shared/geodesy.js';
import { length } from '../shared/vec3.js';

const latLon = { lat: 0, lon: 0 };
const unit = { x: 0, y: 0, z: 0 };

export class Hud {
  constructor(root) {
    this.root = root;
    this.left = document.createElement('div');
    this.right = document.createElement('div');
    this.left.className = 'panel';
    this.right.className = 'panel right';
    root.append(this.left, this.right);
    this.frames = 0;
    this.fps = 0;
    this.accumulator = 0;
  }

  tick(dt) {
    this.frames += 1;
    this.accumulator += dt;
    if (this.accumulator >= 0.5) {
      this.fps = this.frames / this.accumulator;
      this.frames = 0;
      this.accumulator = 0;
    }
  }

  update(state) {
    const { observer, views, envTime, info, surface, groundAltitude, terrainStats } = state;
    const rows = BODY_IDS.map((id) => {
      const body = BODIES[id];
      const placement = views.placements[id];
      const surfaceDistance = Math.max(0, placement.surfaceDistance || 0);
      const pass = placement.far ? 'far' : 'near';
      return `<tr><td>${body.name}</td><td>${formatDistance(surfaceDistance)}</td><td class="${pass}">${pass}</td></tr>`;
    }).join('');

    const days = envTime / 86400;
    this.left.innerHTML = `
      <h1>GZOWO ORBIT<span>phase 1 &middot; ground</span></h1>
      <table>
        <tr><th>body</th><th>altitude</th><th>pass</th></tr>
        ${rows}
      </table>
      <p>mission day ${days.toFixed(2)}</p>
    `;

    const localRadius = length(observer.local);
    const world = Math.hypot(state.origin.x, state.origin.y, state.origin.z);
    let position = '&mdash;';
    if (surface && localRadius > 0) {
      unit.x = observer.local.x / localRadius;
      unit.y = observer.local.y / localRadius;
      unit.z = observer.local.z / localRadius;
      directionToLatLon(unit, latLon);
      const lat = degrees(latLon.lat);
      const lon = degrees(latLon.lon);
      position = `${Math.abs(lat).toFixed(3)}&deg;${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(3)}&deg;${lon >= 0 ? 'E' : 'W'}`;
    }

    this.right.innerHTML = `
      <table>
        <tr><td>throttle</td><td>${formatSpeed(observer.cruiseSpeed)}</td></tr>
        <tr><td>speed</td><td>${formatSpeed(observer.speed)}</td></tr>
        <tr><td>frame</td><td>${BODIES[observer.frame].name}</td></tr>
        <tr><td>position</td><td>${position}</td></tr>
        <tr><td>above ground</td><td>${surface ? formatDistance(groundAltitude) : '&mdash;'}</td></tr>
        <tr><td>world radius</td><td>${formatDistance(world)}</td></tr>
        <tr><td>patches drawn</td><td>${terrainStats.patches}</td></tr>
        <tr><td>patches loaded</td><td>${terrainStats.loaded}</td></tr>
        <tr><td>building</td><td>${terrainStats.inflight}</td></tr>
        <tr><td>draw calls</td><td>${info.calls}</td></tr>
        <tr><td>fps</td><td>${this.fps.toFixed(0)}</td></tr>
      </table>
      <p>WASD move &middot; R/F up-down &middot; Q/E roll &middot; wheel throttle &middot; shift boost<br>1 Sun &middot; 2 Earth &middot; 3 Moon &middot; 4 Mars</p>
    `;
  }
}
