// A single shell around the planet with the scattering integral evaluated along the view
// ray. Cheap enough for four samples, honest enough to give a blue limb from orbit and a
// red one at the terminator - the two things that tell you a planet has air.
//
// The camera always sits at the scene origin, so the ray origin is exactly zero and the
// planet centre arrives as a uniform. That removes the usual precision trouble of
// intersecting a 6371 km sphere in float32.

import * as THREE from 'three';

const vertexShader = `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vRay;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vRay = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCentre;
  uniform vec3 uSunDir;
  uniform vec3 uTint;
  uniform float uPlanetRadius;
  uniform float uShellRadius;
  uniform float uDensity;
  varying vec3 vRay;

  vec2 sphereHit(vec3 origin, vec3 dir, vec3 centre, float radius) {
    vec3 oc = origin - centre;
    float b = dot(oc, dir);
    float c = dot(oc, oc) - radius * radius;
    float h = b * b - c;
    if (h < 0.0) return vec2(-1.0, -1.0);
    h = sqrt(h);
    return vec2(-b - h, -b + h);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 dir = normalize(vRay);
    vec2 shell = sphereHit(vec3(0.0), dir, uCentre, uShellRadius);
    if (shell.y <= 0.0) discard;

    float near = max(shell.x, 0.0);
    float far = shell.y;
    vec2 ground = sphereHit(vec3(0.0), dir, uCentre, uPlanetRadius);
    bool hitsGround = ground.x > 0.0;
    if (hitsGround) far = min(far, ground.x);
    if (far <= near) discard;

    float thickness = uShellRadius - uPlanetRadius;
    float scale = thickness * 0.28;
    float accumulated = 0.0;
    float sunlit = 0.0;
    const int STEPS = 4;
    for (int i = 0; i < STEPS; i += 1) {
      float t = near + (far - near) * ((float(i) + 0.5) / float(STEPS));
      vec3 p = dir * t;
      vec3 up = normalize(p - uCentre);
      float altitude = length(p - uCentre) - uPlanetRadius;
      float density = exp(-max(altitude, 0.0) / scale);
      accumulated += density;
      sunlit += density * smoothstep(-0.35, 0.25, dot(up, uSunDir));
    }
    accumulated /= float(STEPS);
    sunlit /= float(STEPS);

    float path = (far - near) / thickness;
    float amount = clamp(accumulated * path * uDensity, 0.0, 1.0);
    float grazing = pow(clamp(1.0 - abs(dot(dir, normalize(uCentre))), 0.0, 1.0), 1.4);
    vec3 colour = mix(uTint, uTint.bgr * 1.15, pow(1.0 - sunlit, 2.5) * 0.65);

    float alpha = amount * sunlit * (0.55 + grazing * 0.9);
    if (hitsGround) alpha *= 0.62;
    gl_FragColor = vec4(colour, clamp(alpha, 0.0, 1.0));
    #include <colorspace_fragment>
  }
`;

export class Atmosphere {
  constructor(scene, planetRadius, height, tint, density) {
    this.scene = scene;
    this.planetRadius = planetRadius;
    this.shellRadius = planetRadius + height;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.BackSide,
      uniforms: {
        uCentre: { value: new THREE.Vector3() },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uTint: { value: new THREE.Color().fromArray(tint) },
        uPlanetRadius: { value: planetRadius },
        uShellRadius: { value: this.shellRadius },
        uDensity: { value: density },
      },
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(this.shellRadius, 4), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    scene.add(this.mesh);
  }

  update(offset, sunDirection) {
    this.mesh.position.set(offset.x, offset.y, offset.z);
    this.material.uniforms.uCentre.value.set(offset.x, offset.y, offset.z);
    this.material.uniforms.uSunDir.value.set(sunDirection.x, sunDirection.y, sunDirection.z);
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
