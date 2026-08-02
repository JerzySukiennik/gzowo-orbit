// Sound.
//
// Two kinds, and the split is deliberate: anything that has to REACT is synthesised, and
// anything that has to be RECOGNISED is fetched. An engine note is the first kind - it
// has to slide with the throttle, and a downloaded loop can only ever be a loop. Wind and
// radio are the second kind, and no oscillator will ever be mistaken for them.
//
// The same rule Gzowo Meadow arrived at, applied to a ship instead of a field.

const AMBIENT = {
  // CC0, CORS-open, no key. If any of them is unreachable the game is quieter and says
  // nothing about it - sound is never allowed to be the reason a session does not start.
  earth: 'https://cdn.freesound.org/previews/316/316847_5123451-lq.mp3',
  mars: 'https://cdn.freesound.org/previews/436/436711_9013179-lq.mp3',
};

export class Audio {
  constructor() {
    this.context = null;
    this.master = null;
    this.enabled = false;
    this.volume = 0.6;
    this.buffers = new Map();
    this.ambient = null;
    this.nodes = {};
  }

  // Browsers will not start audio before a gesture, so the whole thing is built on the
  // first click rather than at load, and everything before that is a no-op.
  start() {
    if (this.context) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.context = new Context();
    this.master = this.context.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.context.destination);
    this.enabled = true;
    this.buildEngine();
    this.buildAlarm();
  }

  buildEngine() {
    const ctx = this.context;
    const noise = ctx.createBufferSource();
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    noise.buffer = buffer;
    noise.loop = true;

    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 120;
    band.Q.value = 0.8;

    const rumble = ctx.createOscillator();
    rumble.type = 'sawtooth';
    rumble.frequency.value = 42;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0;

    const gain = ctx.createGain();
    gain.gain.value = 0;

    noise.connect(band).connect(gain).connect(this.master);
    rumble.connect(rumbleGain).connect(this.master);
    noise.start();
    rumble.start();
    this.nodes.engine = { gain, band, rumble, rumbleGain };
  }

  buildAlarm() {
    const ctx = this.context;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 660;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(this.master);
    osc.start();
    this.nodes.alarm = { osc, gain };
  }

  async loadAmbient(bodyId) {
    if (!this.enabled || !AMBIENT[bodyId]) return this.stopAmbient();
    if (this.ambient && this.ambient.body === bodyId) return;
    this.stopAmbient();
    try {
      if (!this.buffers.has(bodyId)) {
        const response = await fetch(AMBIENT[bodyId], { mode: 'cors' });
        if (!response.ok) return;
        this.buffers.set(bodyId, await this.context.decodeAudioData(await response.arrayBuffer()));
      }
      const source = this.context.createBufferSource();
      source.buffer = this.buffers.get(bodyId);
      source.loop = true;
      const gain = this.context.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.master);
      source.start();
      this.ambient = { body: bodyId, source, gain };
    } catch (error) {
      /* quieter, not broken */
    }
  }

  stopAmbient() {
    if (!this.ambient) return;
    try {
      this.ambient.source.stop();
    } catch (error) {
      /* already stopped */
    }
    this.ambient = null;
  }

  setVolume(value) {
    this.volume = value;
    if (this.master) this.master.gain.value = value;
  }

  // Called every frame with the state of the world, not with events: an engine is a
  // continuous thing and the mixer should read it as one.
  update(state, dt) {
    if (!this.enabled) return;
    const { engine, alarm } = this.nodes;
    const inAir = state.density > 0.002;
    const thrust = Math.min(1, state.thrust);

    // In vacuum you hear the ship through the hull, not through the air outside, so
    // thrust is felt as low rumble and almost no hiss.
    const hiss = thrust * (state.aboard ? (inAir ? 0.22 : 0.06) : inAir ? 0.3 : 0);
    engine.gain.gain.setTargetAtTime(hiss * this.volume, this.context.currentTime, 0.12);
    engine.band.frequency.setTargetAtTime(110 + thrust * 340, this.context.currentTime, 0.15);
    engine.rumbleGain.gain.setTargetAtTime(thrust * (state.aboard ? 0.16 : 0.02), this.context.currentTime, 0.1);
    engine.rumble.frequency.setTargetAtTime(34 + thrust * 26, this.context.currentTime, 0.2);

    const warn = state.alarm ? 0.05 + 0.05 * Math.sin(this.context.currentTime * 18) : 0;
    alarm.gain.gain.setTargetAtTime(warn, this.context.currentTime, 0.05);

    if (this.ambient) {
      const target = state.aboard ? 0.03 : inAir ? 0.25 : 0.01;
      this.ambient.gain.gain.setTargetAtTime(target, this.context.currentTime, 0.4);
    }
  }
}
