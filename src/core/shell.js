// Menu, settings, photo mode and the save slot.
//
// This is the one part of the interface allowed to be a DOM overlay rather than a panel
// in the world: it is the game talking about itself, not the ship talking to its crew.

import { EFFECTS } from './post.js';

const SAVE_KEY = 'gzowo-orbit-save';

const SLIDERS = [
  { key: 'exposure', label: 'Exposure', min: 0.4, max: 2, step: 0.05 },
  { key: 'bloom', label: 'Bloom', min: 0, max: 1.5, step: 0.05 },
  { key: 'flare', label: 'Sun flare', min: 0, max: 1.5, step: 0.05 },
  { key: 'grain', label: 'Grain', min: 0, max: 1, step: 0.05 },
  { key: 'vignette', label: 'Vignette', min: 0, max: 1, step: 0.05 },
];

export class Shell {
  constructor(root, hooks) {
    this.hooks = hooks;
    this.photo = false;
    this.settingsOpen = false;
    this.started = false;

    this.overlay = document.createElement('div');
    this.overlay.className = 'shell';
    this.overlay.innerHTML = `
      <div class="shell-card">
        <h2>GZOWO ORBIT</h2>
        <p class="shell-sub">A crew, a ship, and a Solar System at 1:1</p>
        <button class="shell-go">Take the pilot seat</button>
        <div class="shell-keys">
          <span>mouse steers</span><span>W/S main</span><span>shift/ctrl lift</span><span>Q/E roll</span>
          <span>E sit or stand</span><span>O airlock</span><span>B rover</span><span>Z cut</span>
          <span>X drill</span><span>K repair</span><span>J target</span><span>enter jump</span>
          <span>T sell</span><span>U fit module</span><span>F2 settings</span><span>F3 photo</span>
        </div>
      </div>
    `;
    root.append(this.overlay);

    this.panel = document.createElement('div');
    this.panel.className = 'panel settings';
    this.panel.style.display = 'none';
    root.append(this.panel);
    this.buildSettings();

    this.overlay.querySelector('.shell-go').addEventListener('click', () => this.begin());
    window.addEventListener('keydown', (event) => {
      if (event.code === 'F2') {
        this.settingsOpen = !this.settingsOpen;
        this.panel.style.display = this.settingsOpen ? 'block' : 'none';
        event.preventDefault();
      }
      if (event.code === 'F3') {
        this.photo = !this.photo;
        event.preventDefault();
      }
      if (event.code === 'F5') {
        this.hooks.save();
        event.preventDefault();
      }
      if (event.code === 'F9') {
        this.hooks.load();
        event.preventDefault();
      }
    });
  }

  begin() {
    this.started = true;
    this.overlay.style.display = 'none';
    this.hooks.start();
    // Dismissing the menu has to hand the mouse to the ship in the same gesture. Without
    // it the game looks broken in the most complete way possible: throttles respond,
    // nothing steers, and nothing on screen says why.
    this.hooks.capture();
  }

  buildSettings() {
    const rows = SLIDERS.map(
      (slider) => `
        <label class="setting">
          <span>${slider.label}</span>
          <input type="range" data-key="${slider.key}" min="${slider.min}" max="${slider.max}" step="${slider.step}" value="${EFFECTS[slider.key]}">
          <em data-value="${slider.key}">${EFFECTS[slider.key].toFixed(2)}</em>
        </label>`
    ).join('');

    this.panel.innerHTML = `
      <h1>SETTINGS<span>F2 to close &middot; F3 photo mode &middot; F5 save &middot; F9 load</span></h1>
      ${rows}
      <label class="setting"><span>Volume</span><input type="range" data-key="volume" min="0" max="1" step="0.05" value="0.6"><em data-value="volume">0.60</em></label>
      <label class="setting"><span>Resolution</span><input type="range" data-key="quality" min="0.5" max="2" step="0.1" value="1.5"><em data-value="quality">1.50</em></label>
      <p>Effects back off by themselves when the frame budget slips; these sliders set the ceiling.</p>
    `;

    this.panel.addEventListener('input', (event) => {
      const key = event.target.dataset.key;
      if (!key) return;
      const value = Number(event.target.value);
      this.panel.querySelector(`[data-value="${key}"]`).textContent = value.toFixed(2);
      if (key === 'volume') this.hooks.volume(value);
      else if (key === 'quality') this.hooks.quality(value);
      else this.hooks.effects({ [key]: value });
    });
  }

  // Effects are dropped in a fixed order when frames get long, and the order is the one
  // Jurek chose: smoothness is the thing that must not break.
  autoDegrade(frameMs) {
    if (!this.started) return;
    if (frameMs > 30 && EFFECTS.bloom > 0) this.hooks.effects({ bloom: 0, grain: 0 });
    else if (frameMs > 24 && EFFECTS.flare > 0) this.hooks.effects({ flare: 0 });
  }

  static save(state) {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }

  static load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }
}
