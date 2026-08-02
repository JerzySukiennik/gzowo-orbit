// The cockpit display. It is a real panel in the ship rather than an overlay on the
// screen: it hangs in front of the pilot seat, turns with the ship, and slides out of
// frame when you look over your shoulder. That is the whole reason it is drawn on a
// canvas mapped to geometry instead of into the DOM.

import * as THREE from 'three';
import { elements } from '../shared/orbit.js';
import { BODIES } from '../shared/bodies.js';
import { SHIP, shipMass } from './flight.js';
import { formatDistance, formatSpeed } from '../shared/units.js';

const WIDTH = 1024;
const HEIGHT = 512;
const INK = '#7fd4ff';
const WARN = '#ffb45c';
const ALERT = '#ff6b5c';

export class Cockpit {
  constructor(group, offset) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = WIDTH;
    this.canvas.height = HEIGHT;
    this.context = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;

    const geometry = new THREE.PlaneGeometry(1.72, 0.86, 24, 1);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i += 1) {
      const x = position.getX(i);
      position.setZ(i, -(x * x) * 0.1);
    }
    geometry.computeVertexNormals();

    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.mesh.position.set(offset.x, offset.y - 0.44, offset.z - 1.95);
    this.mesh.frustumCulled = false;
    group.add(this.mesh);
  }

  get visible() {
    return this.mesh.visible;
  }

  set visible(value) {
    this.mesh.visible = value;
  }

  draw(ship, bodyId) {
    const c = this.context;
    const t = ship.telemetry;
    const orbit = elements(bodyId, ship.position, ship.velocity);
    const body = BODIES[bodyId];

    c.clearRect(0, 0, WIDTH, HEIGHT);
    c.font = '600 20px ui-monospace, Menlo, monospace';
    c.textBaseline = 'middle';

    c.strokeStyle = 'rgba(127, 212, 255, 0.28)';
    c.lineWidth = 2;
    c.strokeRect(14, 14, WIDTH - 28, HEIGHT - 28);

    const column = (x, title, rows, tint) => {
      c.fillStyle = 'rgba(127, 212, 255, 0.45)';
      c.font = '500 16px ui-monospace, Menlo, monospace';
      c.fillText(title, x, 52);
      c.font = '600 22px ui-monospace, Menlo, monospace';
      rows.forEach((row, i) => {
        c.fillStyle = row[2] || tint || INK;
        c.fillText(row[0], x, 96 + i * 38);
        const width = c.measureText(row[1]).width;
        c.fillText(row[1], x + 290 - width, 96 + i * 38);
      });
    };

    const gearState = ship.controls.gear ? 'DOWN' : 'UP';
    const hullTint = ship.hull > 0.85 ? INK : ship.hull > 0.5 ? WARN : ALERT;
    const heatTint = ship.heat > SHIP.heatingLimit * 0.7 ? ALERT : ship.heat > SHIP.heatingLimit * 0.35 ? WARN : INK;

    column(56, `FLIGHT / ${body.name.toUpperCase()}`, [
      ['ALT AGL', formatDistance(t.altitude)],
      ['V/S', `${t.verticalSpeed >= 0 ? '+' : ''}${t.verticalSpeed.toFixed(1)} m/s`],
      ['SPEED', formatSpeed(orbit.speed)],
      ['AIRSPEED', t.density > 0 ? formatSpeed(t.airspeed) : '—'],
      ['AoA', t.density > 0 ? `${((t.angleOfAttack * 180) / Math.PI).toFixed(1)}°` : '—'],
      ['G', `${t.gLoad.toFixed(2)}`],
    ]);

    column(400, 'ORBIT', [
      ['APO', orbit.closed ? formatDistance(orbit.apoapsis) : 'ESCAPE'],
      ['PERI', formatDistance(orbit.periapsis), orbit.periapsis < 0 ? WARN : INK],
      ['ECC', orbit.eccentricity.toFixed(4)],
      ['PERIOD', orbit.closed ? `${(orbit.period / 60).toFixed(1)} min` : '—'],
      ['INC', `${((orbit.inclination * 180) / Math.PI).toFixed(1)}°`],
      ['MASS', `${Math.round(shipMass(ship) / 1000)} t`],
    ]);

    column(744, 'SHIP', [
      ['MAIN', `${Math.round(ship.controls.main * 100)}%`],
      ['LIFT', `${Math.round(ship.controls.lift * 100)}%`],
      ['FUEL', `${Math.round((ship.fuel / SHIP.fuelCapacity) * 100)}%`, ship.fuel / SHIP.fuelCapacity < 0.15 ? WARN : INK],
      ['HULL', `${Math.round(ship.hull * 100)}%`, hullTint],
      ['HEAT', `${Math.round((ship.heat / SHIP.heatingLimit) * 100)}%`, heatTint],
      ['GEAR', gearState, ship.controls.gear ? INK : WARN],
    ]);

    const barY = HEIGHT - 66;
    const bar = (x, value, tint) => {
      c.fillStyle = 'rgba(127, 212, 255, 0.16)';
      c.fillRect(x, barY, 260, 12);
      c.fillStyle = tint;
      c.fillRect(x, barY, 260 * Math.max(0, Math.min(1, value)), 12);
    };
    bar(56, ship.controls.main, INK);
    bar(400, ship.controls.lift, INK);
    bar(744, ship.fuel / SHIP.fuelCapacity, ship.fuel / SHIP.fuelCapacity < 0.15 ? WARN : INK);

    const messages = [];
    if (ship.landed) messages.push('LANDED');
    if (ship.hull < 0.6) messages.push('HULL DAMAGE');
    if (ship.heat > SHIP.heatingLimit * 0.7) messages.push('SKIN TEMPERATURE');
    if (orbit.periapsis < 0 && t.altitude > 1000) messages.push('PERIAPSIS INSIDE BODY');
    if (ship.fuel <= 0) messages.push('NO FUEL');
    if (messages.length) {
      c.font = '600 24px ui-monospace, Menlo, monospace';
      c.fillStyle = messages.includes('LANDED') && messages.length === 1 ? INK : ALERT;
      c.fillText(messages.join('   ·   '), 56, HEIGHT - 108);
    }

    this.texture.needsUpdate = true;
  }
}
