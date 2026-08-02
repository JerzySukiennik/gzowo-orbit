// Crew session: one host runs the world, guests send what their hands are doing.
//
// The transport is WebRTC peer to peer. Firebase only ever carries the handshake - the
// address of a crew and the offer/answer pair - and never a single frame of the game,
// which is why the free tier is enough for as many crews as we will ever have. It is
// reached over plain REST plus one server-sent-event stream, so there is no SDK in the
// bundle and nothing to keep in step with a library version.

import { encodeSnapshot, decodeSnapshot, encodeInput, decodeInput, SNAPSHOT_RATE } from './protocol.js';

const ICE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

function code() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// A transport is anything with send() and onmessage. The loopback one exists so the whole
// protocol can be tested without a network, a browser or a second machine.
export class LoopbackTransport {
  constructor() {
    this.onmessage = null;
    this.peer = null;
  }

  static pair() {
    const a = new LoopbackTransport();
    const b = new LoopbackTransport();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  send(payload) {
    if (this.peer && this.peer.onmessage) this.peer.onmessage(JSON.parse(JSON.stringify(payload)));
  }

  close() {
    this.peer = null;
  }
}

export class Signalling {
  constructor(config) {
    this.config = config;
    this.base = config ? `${config.databaseURL.replace(/\/$/, '')}` : null;
  }

  get available() {
    return Boolean(this.base);
  }

  async write(path, value) {
    await fetch(`${this.base}/${path}.json`, {
      method: 'PUT',
      body: JSON.stringify(value),
    });
  }

  async read(path) {
    const response = await fetch(`${this.base}/${path}.json`);
    if (!response.ok) return null;
    return response.json();
  }

  async remove(path) {
    await fetch(`${this.base}/${path}.json`, { method: 'DELETE' });
  }

  // Server-sent events rather than polling: a guest waiting for an answer should hear it
  // the moment it lands, and a crew list should stop being wrong the moment a crew ends.
  watch(path, handler) {
    const source = new EventSource(`${this.base}/${path}.json`);
    const forward = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handler(payload.path, payload.data);
      } catch (error) {
        /* keep-alives are not JSON */
      }
    };
    source.addEventListener('put', forward);
    source.addEventListener('patch', forward);
    return () => source.close();
  }
}

export class CrewSession {
  constructor(options = {}) {
    this.signalling = new Signalling(options.firebase || null);
    this.role = 'solo';
    this.code = null;
    this.name = options.name || 'Crew';
    this.peers = new Map();
    this.guestState = null;
    this.inputs = new Map();
    this.onSnapshot = null;
    this.lastSent = 0;
    this.stopWatching = null;
    this.status = this.signalling.available ? 'offline' : 'no signalling config';
    this.publicListing = true;
  }

  get connected() {
    return this.role !== 'solo';
  }

  get crewSize() {
    return this.role === 'host' ? this.peers.size + 1 : this.guestState ? this.guestState.crew.length : 1;
  }

  async host({ publicListing = true } = {}) {
    if (!this.signalling.available) {
      this.status = 'no signalling config';
      return null;
    }
    this.role = 'host';
    this.code = code();
    this.publicListing = publicListing;
    await this.signalling.write(`crews/${this.code}`, {
      name: this.name,
      open: publicListing,
      started: Date.now(),
    });
    this.stopWatching = this.signalling.watch(`crews/${this.code}/offers`, (path, data) => {
      if (!data) return;
      const entries = path === '/' ? Object.entries(data) : [[path.replace('/', ''), data]];
      for (const [guestId, offer] of entries) {
        if (offer && offer.sdp) this.acceptGuest(guestId, offer);
      }
    });
    this.status = `hosting ${this.code}`;
    return this.code;
  }

  async acceptGuest(guestId, offer) {
    if (this.peers.has(guestId)) return;
    const connection = new RTCPeerConnection({ iceServers: ICE });
    const peer = { id: guestId, connection, channel: null, ready: false };
    this.peers.set(guestId, peer);

    connection.ondatachannel = (event) => {
      peer.channel = event.channel;
      peer.channel.onmessage = (message) => this.receiveFromGuest(guestId, JSON.parse(message.data));
      peer.channel.onopen = () => {
        peer.ready = true;
      };
      peer.channel.onclose = () => this.peers.delete(guestId);
    };
    await connection.setRemoteDescription(offer);
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    await new Promise((resolve) => {
      if (connection.iceGatheringState === 'complete') return resolve();
      connection.onicegatheringstatechange = () => {
        if (connection.iceGatheringState === 'complete') resolve();
      };
      setTimeout(resolve, 2500);
    });
    await this.signalling.write(`crews/${this.code}/answers/${guestId}`, {
      type: connection.localDescription.type,
      sdp: connection.localDescription.sdp,
    });
  }

  async join(crewCode) {
    if (!this.signalling.available) {
      this.status = 'no signalling config';
      return false;
    }
    const guestId = code();
    const connection = new RTCPeerConnection({ iceServers: ICE });
    const channel = connection.createDataChannel('crew', { ordered: false, maxRetransmits: 0 });
    channel.onmessage = (message) => this.receiveFromHost(JSON.parse(message.data));
    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await new Promise((resolve) => {
      if (connection.iceGatheringState === 'complete') return resolve();
      connection.onicegatheringstatechange = () => {
        if (connection.iceGatheringState === 'complete') resolve();
      };
      setTimeout(resolve, 2500);
    });
    await this.signalling.write(`crews/${crewCode}/offers/${guestId}`, {
      type: connection.localDescription.type,
      sdp: connection.localDescription.sdp,
    });

    this.role = 'guest';
    this.code = crewCode;
    this.channel = channel;
    this.status = `joining ${crewCode}`;
    this.stopWatching = this.signalling.watch(`crews/${crewCode}/answers/${guestId}`, async (path, data) => {
      if (!data || !data.sdp || connection.remoteDescription) return;
      await connection.setRemoteDescription(data);
      this.status = `joined ${crewCode}`;
    });
    return true;
  }

  async listCrews() {
    if (!this.signalling.available) return [];
    const crews = (await this.signalling.read('crews')) || {};
    return Object.entries(crews)
      .filter(([, crew]) => crew && crew.open)
      .map(([id, crew]) => ({ code: id, name: crew.name, started: crew.started }));
  }

  // Used by the tests and by a second tab on the same machine: skips the handshake and
  // wires two sessions straight together.
  attachLoopback(transport, asRole) {
    this.role = asRole;
    this.transport = transport;
    transport.onmessage = (payload) => {
      if (asRole === 'host') this.receiveFromGuest('loopback', payload);
      else this.receiveFromHost(payload);
    };
    this.status = `loopback ${asRole}`;
  }

  receiveFromGuest(guestId, payload) {
    if (payload.type === 'input') this.inputs.set(guestId, decodeInput(payload.data));
  }

  receiveFromHost(payload) {
    if (payload.type !== 'snapshot') return;
    this.guestState = decodeSnapshot(payload.data, this.guestState || undefined);
    if (this.onSnapshot) this.onSnapshot(this.guestState);
  }

  sendInput(input) {
    const payload = { type: 'input', data: encodeInput(input) };
    if (this.transport) return this.transport.send(payload);
    if (this.channel && this.channel.readyState === 'open') this.channel.send(JSON.stringify(payload));
  }

  broadcast(state, now) {
    if (this.role !== 'host') return false;
    const period = 1 / SNAPSHOT_RATE;
    if (now - this.lastSent < period) return false;
    // Advance by a whole period rather than snapping to now. Snapping lets the rounding
    // error in an accumulated clock eat a snapshot every few frames: measured 16.3 Hz out
    // of a gate that was supposed to hold 20.
    this.lastSent = now - this.lastSent > period * 3 ? now : this.lastSent + period;
    const payload = { type: 'snapshot', data: encodeSnapshot(state) };
    if (this.transport) this.transport.send(payload);
    for (const peer of this.peers.values()) {
      if (peer.channel && peer.channel.readyState === 'open') peer.channel.send(JSON.stringify(payload));
    }
    return true;
  }

  async close() {
    if (this.stopWatching) this.stopWatching();
    if (this.role === 'host' && this.code && this.signalling.available) {
      await this.signalling.remove(`crews/${this.code}`);
    }
    for (const peer of this.peers.values()) peer.connection.close();
    this.peers.clear();
    this.role = 'solo';
    this.status = 'offline';
  }
}
