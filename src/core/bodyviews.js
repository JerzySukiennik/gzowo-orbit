// One mesh per celestial body, re-parented every frame into whichever pass its distance
// puts it in. Lighting comes from a per-body sun direction uniform rather than a scene
// light, because Earth and Mars are lit from directions 380 Gm apart.

import * as THREE from 'three';
import { BODIES, BODY_IDS, positionAt, rotationAt } from '../shared/bodies.js';
import { place } from '../shared/frame.js';
import { vec3, sub, normalize } from '../shared/vec3.js';

const vertexShader = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vNormalW;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 world = modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColour;
  uniform vec3 uSunDir;
  uniform float uAmbient;
  varying vec3 vNormalW;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 n = normalize(vNormalW);
    float incidence = dot(n, uSunDir);
    float terminator = smoothstep(-0.06, 0.10, incidence);
    float lambert = max(incidence, 0.0);
    vec3 lit = uColour * (uAmbient + lambert * terminator * 1.25);
    gl_FragColor = vec4(lit, 1.0);
    #include <colorspace_fragment>
  }
`;

export class BodyViews {
  constructor(farScene, nearScene) {
    this.farScene = farScene;
    this.nearScene = nearScene;
    this.geometry = new THREE.IcosahedronGeometry(1, 5);
    this.entries = [];
    this.positions = {};
    this.placements = {};

    for (const id of BODY_IDS) {
      const body = BODIES[id];
      const colour = new THREE.Color(body.colour).convertSRGBToLinear();
      const material = body.emissive
        ? new THREE.MeshBasicMaterial({ color: colour })
        : new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
              uColour: { value: colour },
              uSunDir: { value: new THREE.Vector3(1, 0, 0) },
              uAmbient: { value: 0.035 },
            },
          });

      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      this.entries.push({ id, body, mesh, material });
      this.positions[id] = vec3();
      this.placements[id] = { distance: 0, scale: 1, far: true };
    }

    this.tilt = new THREE.Quaternion();
    this.spin = new THREE.Quaternion();
    this.tiltAxis = new THREE.Vector3(0, 0, 1);
    this.spinAxis = new THREE.Vector3(0, 1, 0);
    this.scenePosition = vec3();
    this.sunOffset = vec3();
    this.sunDirection = vec3();
  }

  updatePositions(time) {
    for (const id of BODY_IDS) positionAt(id, time, this.positions[id]);
  }

  place(time, origin) {
    for (const entry of this.entries) {
      const { id, body, mesh, material } = entry;
      const worldPosition = this.positions[id];
      const placement = place(worldPosition, origin, body.radius, this.scenePosition);
      this.placements[id] = placement;
      placement.surfaceDistance = placement.trueDistance - body.radius;

      mesh.position.set(this.scenePosition.x, this.scenePosition.y, this.scenePosition.z);
      mesh.scale.setScalar(body.radius * placement.scale);

      this.tilt.setFromAxisAngle(this.tiltAxis, body.axialTilt || 0);
      this.spin.setFromAxisAngle(this.spinAxis, rotationAt(id, time));
      mesh.quaternion.copy(this.tilt).multiply(this.spin);

      if (material.uniforms) {
        sub(this.sunOffset, this.positions.sun, worldPosition);
        normalize(this.sunDirection, this.sunOffset);
        material.uniforms.uSunDir.value.set(this.sunDirection.x, this.sunDirection.y, this.sunDirection.z);
      }

      const target = placement.far ? this.farScene : this.nearScene;
      if (mesh.parent !== target) target.add(mesh);
    }
  }
}
