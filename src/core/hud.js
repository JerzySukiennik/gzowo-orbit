// Temporary flight-test readout. Phase 2 replaces it with the diegetic cockpit; nothing
// here survives past that, so it stays a plain overlay on purpose.

import { BODIES, BODY_IDS } from '../shared/bodies.js';
import { formatDistance, formatSpeed } from '../shared/units.js';

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
    this.worstFrame = 0;
  }

  tick(dt) {
    this.frames += 1;
    this.accumulator += dt;
    this.worstFrame = Math.max(this.worstFrame, dt);
    if (this.accumulator >= 0.5) {
      this.fps = this.frames / this.accumulator;
      this.frames = 0;
      this.accumulator = 0;
      this.worstFrame = 0;
    }
  }

  update(state) {
    const { observer, views, envTime, info } = state;
    const rows = BODY_IDS.map((id) => {
      const body = BODIES[id];
      const placement = views.placements[id];
      const surface = Math.max(0, placement.surfaceDistance || 0);
      const pass = placement.far ? 'far' : 'near';
      return `<tr><td>${body.name}</td><td>${formatDistance(surface)}</td><td class="${pass}">${pass}</td></tr>`;
    }).join('');

    const days = envTime / 86400;
    this.left.innerHTML = `
      <h1>GZOWO ORBIT<span>phase 0 &middot; frame of reference</span></h1>
      <table>
        <tr><th>body</th><th>altitude</th><th>pass</th></tr>
        ${rows}
      </table>
      <p>mission day ${days.toFixed(2)}</p>
    `;

    const local = Math.hypot(observer.local.x, observer.local.y, observer.local.z);
    const world = Math.hypot(state.origin.x, state.origin.y, state.origin.z);
    this.right.innerHTML = `
      <table>
        <tr><td>throttle</td><td>${formatSpeed(observer.cruiseSpeed)}</td></tr>
        <tr><td>speed</td><td>${formatSpeed(observer.speed)}</td></tr>
        <tr><td>frame</td><td>${BODIES[observer.frame].name}</td></tr>
        <tr><td>frame offset</td><td>${formatDistance(local)}</td></tr>
        <tr><td>world radius</td><td>${formatDistance(world)}</td></tr>
        <tr><td>scene origin</td><td>0.000 m</td></tr>
        <tr><td>draw calls</td><td>${info.calls}</td></tr>
        <tr><td>fps</td><td>${this.fps.toFixed(0)}</td></tr>
      </table>
      <p>WASD move &middot; R/F up-down &middot; Q/E roll &middot; wheel throttle &middot; shift boost<br>1 Sun &middot; 2 Earth &middot; 3 Moon &middot; 4 Mars</p>
    `;
  }
}
