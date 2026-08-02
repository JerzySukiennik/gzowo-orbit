// The helmet display: a small curved panel just inside the glass, plus the rim of the
// visor itself. Like the cockpit panel it lives in the world rather than on the screen,
// so it stays put when the astronaut turns their head inside the helmet.

import * as THREE from 'three';
import { SUIT } from './astronaut.js';
import { BODIES } from '../shared/bodies.js';
import { formatDistance } from '../shared/units.js';

const WIDTH = 512;
const HEIGHT = 256;
const INK = '#8fe3ff';
const WARN = '#ffb45c';
const ALERT = '#ff6b5c';

export class Visor {
  constructor(scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;

    this.group = new THREE.Group();
    this.group.frustumCulled = false;
    scene.add(this.group);

    const geometry = new THREE.PlaneGeometry(0.28, 0.14, 16, 1);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      position.setZ(i, -(x * x) * 0.28);
    }
    this.panel = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        side: THREE.DoubleSide,
      })
    );
    this.panel.position.set(0, -0.085, -0.44);
    this.panel.frustumCulled = false;
    this.panel.renderOrder = 20;
    this.group.add(this.panel);
    this.group.visible = false;
  }

  set visible(value) {
    this.group.visible = value;
  }

  get visible() {
    return this.group.visible;
  }

  // The panel rides with the camera: it is fixed to the helmet, and the helmet is fixed
  // to the head. Position zero because every camera in this game sits at the origin.
  place(orientation) {
    this.group.quaternion.copy(orientation);
  }

  draw(astronaut, environment) {
    const c = this.context;
    c.clearRect(0, 0, WIDTH, HEIGHT);
    c.textBaseline = 'middle';

    const minutes = Math.max(0, astronaut.oxygen) / 60;
    const oxygenTint = minutes > 5 ? INK : minutes > 2 ? WARN : ALERT;

    c.strokeStyle = 'rgba(143, 227, 255, 0.22)';
    c.lineWidth = 2;
    c.strokeRect(10, 10, WIDTH - 20, HEIGHT - 20);

    c.font = '500 15px ui-monospace, Menlo, monospace';
    c.fillStyle = 'rgba(143, 227, 255, 0.5)';
    c.fillText(`SUIT / ${BODIES[astronaut.frame].name.toUpperCase()}`, 30, 38);

    const rows = [
      ['O2', `${Math.floor(minutes)}:${String(Math.floor((minutes % 1) * 60)).padStart(2, '0')}`, oxygenTint],
      ['BOTTLES', `${astronaut.bottles}`, astronaut.bottles > 0 ? INK : WARN],
      ['ALT', formatDistance(Math.max(0, astronaut.altitude)), INK],
      ['G', `${BODIES[astronaut.frame].surfaceGravity.toFixed(2)} m/s²`, INK],
      ['TETHER', astronaut.mode === 'eva' ? `${environment.tether.toFixed(0)} / ${SUIT.tetherLength} m` : 'STOWED', environment.tether > SUIT.tetherLength * 0.9 ? WARN : INK],
      ['SUIT', `${Math.round(astronaut.health * 100)}%`, astronaut.health > 0.6 ? INK : ALERT],
    ];

    c.font = '600 19px ui-monospace, Menlo, monospace';
    rows.forEach((row, i) => {
      const x = i < 3 ? 30 : 272;
      const y = 78 + (i % 3) * 40;
      c.fillStyle = 'rgba(143, 227, 255, 0.55)';
      c.fillText(row[0], x, y);
      c.fillStyle = row[2];
      const width = c.measureText(row[1]).width;
      c.fillText(row[1], x + 210 - width, y);
    });

    const bar = 214;
    c.fillStyle = 'rgba(143, 227, 255, 0.16)';
    c.fillRect(30, bar, WIDTH - 60, 10);
    c.fillStyle = oxygenTint;
    c.fillRect(30, bar, (WIDTH - 60) * Math.max(0, Math.min(1, astronaut.oxygen / SUIT.oxygenSeconds)), 10);

    if (environment.deposit) {
      const d = environment.deposit;
      c.font = '600 17px ui-monospace, Menlo, monospace';
      c.fillStyle = d.inRange ? INK : 'rgba(143, 227, 255, 0.6)';
      const text = d.inRange
        ? `${d.label.toUpperCase()} — UNDER FOOT, Z TO CUT`
        : `${d.label.toUpperCase()} ${Math.round(d.distance)} m ${d.bearing}`;
      c.fillText(text, 30, 190);
    }

    if (astronaut.down) {
      c.font = '700 22px ui-monospace, Menlo, monospace';
      c.fillStyle = ALERT;
      c.fillText('DOWN — CREW ASSISTANCE REQUIRED', 30, 190);
    } else if (minutes < 2) {
      c.font = '700 20px ui-monospace, Menlo, monospace';
      c.fillStyle = ALERT;
      c.fillText('OXYGEN LOW', 30, 190);
    }

    this.texture.needsUpdate = true;
  }
}
