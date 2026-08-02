// Other people. Deliberately plain shapes: a crew member is readable as a person-sized
// thing at the right place long before it is worth modelling one, and a wrong position is
// obvious with a capsule while a good model would only hide it.

import * as THREE from 'three';
import { vec3, add, sub } from '../shared/vec3.js';
import { rotateVector } from '../shared/quat.js';

const local = vec3();
const world = vec3();

export class CrewView {
  constructor(scene) {
    this.scene = scene;
    this.avatars = new Map();
    this.geometry = new THREE.CapsuleGeometry(0.36, 1.1, 4, 10);
    this.material = new THREE.MeshStandardMaterial({ color: 0xdfe7ef, roughness: 0.55, metalness: 0.1 });
    this.visorMaterial = new THREE.MeshStandardMaterial({
      color: 0x121820,
      roughness: 0.15,
      metalness: 0.6,
      emissive: 0x1b3550,
      emissiveIntensity: 0.6,
    });
  }

  acquire(id) {
    let avatar = this.avatars.get(id);
    if (avatar) return avatar;
    const group = new THREE.Group();
    const body = new THREE.Mesh(this.geometry, this.material);
    body.position.y = 0.9;
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.29, 12, 10), this.visorMaterial);
    visor.position.set(0, 1.62, -0.06);
    group.add(body, visor);
    group.frustumCulled = false;
    this.scene.add(group);
    avatar = { group };
    this.avatars.set(id, avatar);
    return avatar;
  }

  // Crew aboard are positioned in ship space and ride with the hull; crew outside are
  // positioned in body space. Same avatar, two frames, decided per person per frame.
  update(members, ship, shipWorldPosition, bodyPositions, cameraOrigin, selfId) {
    const seen = new Set();
    for (const member of members) {
      if (member.id === selfId) continue;
      seen.add(member.id);
      const avatar = this.acquire(member.id);
      if (member.aboard) {
        rotateVector(local, member.position, ship.orientation);
        add(world, shipWorldPosition, local);
        avatar.group.quaternion.set(ship.orientation.x, ship.orientation.y, ship.orientation.z, ship.orientation.w);
      } else {
        const base = bodyPositions[member.frame] || bodyPositions[ship.frame];
        add(world, base, member.position);
        avatar.group.quaternion.identity();
      }
      sub(world, world, cameraOrigin);
      avatar.group.position.set(world.x, world.y, world.z);
      avatar.group.visible = true;
    }
    for (const [id, avatar] of this.avatars) {
      if (!seen.has(id)) avatar.group.visible = false;
    }
  }
}
