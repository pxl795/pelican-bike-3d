import * as THREE from 'three';

export const TRACK_R = 14;
const ISLAND_R = 26;

function rng(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = (h) => new THREE.Color(h);
export const PRESETS = {
  day: {
    top: C('#3f7fd1'), horizon: C('#c4e2f2'), bottom: C('#2a5f86'), discColor: C('#fff1d0'), discSize: 0.0016,
    elev: 0.95, az: 0.7, light: C('#fff4dc'), lightI: 2.8, hemiSky: C('#cfe8ff'), hemiGround: C('#b39b72'), hemiI: 0.9,
    fog: C('#bcd9ea'), fogD: 0.0055, lamp: 0, beam: 0, stars: 0, deep: C('#0f4a68'), shallow: C('#2aa3b5'), exposure: 1.0, bloom: 0.22,
  },
  dusk: {
    top: C('#2b2a5c'), horizon: C('#f7995a'), bottom: C('#3a2f4d'), discColor: C('#ffb36a'), discSize: 0.003,
    elev: 0.07, az: -2.3, light: C('#ffaa6a'), lightI: 2.4, hemiSky: C('#f2a77a'), hemiGround: C('#3d2d3c'), hemiI: 0.75,
    fog: C('#d68a6c'), fogD: 0.0075, lamp: 0.45, beam: 0.35, stars: 0.25, deep: C('#271f3e'), shallow: C('#b0605a'), exposure: 1.05, bloom: 0.5,
  },
  night: {
    top: C('#03061a'), horizon: C('#1b2a55'), bottom: C('#03050d'), discColor: C('#dfe6ff'), discSize: 0.0012,
    elev: 0.55, az: 2.2, light: C('#8ea6ff'), lightI: 0.55, hemiSky: C('#33427a'), hemiGround: C('#0d0f18'), hemiI: 0.4,
    fog: C('#0d1530'), fogD: 0.0095, lamp: 1, beam: 1, stars: 1, deep: C('#040919'), shallow: C('#132449'), exposure: 0.95, bloom: 0.85,
  },
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); gl_Position.z = gl_Position.w; }`;
const skyFrag = /* glsl */ `
uniform vec3 top, horizon, bottom, discColor, discDir; uniform float discSize;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir); float h = d.y;
  vec3 c = h > 0. ? mix(horizon, top, pow(h, .55)) : mix(horizon, bottom, pow(-h, .4));
  float s = dot(d, normalize(discDir));
  c += discColor * (smoothstep(1.-discSize, 1.-discSize*.55, s) * 3. + pow(max(s,0.), 90.) * .5 + pow(max(s,0.), 7.) * .16);
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const waterVert = /* glsl */ `
uniform float uTime; varying vec3 vWorld; varying vec3 vN;
vec3 waves(vec2 p){
  vec3 r = vec3(0.); vec2 d; float ph;
  #define W(dx,dz,F,A,S) d = normalize(vec2(dx,dz)); ph = dot(d,p)*F + uTime*S; r.x += A*sin(ph); r.yz += A*F*cos(ph)*d;
  W(1.,.3,.35,.12,1.1) W(-.4,1.,.6,.06,1.7) W(.7,-.8,1.3,.025,2.6) W(-1.,-.2,2.1,.012,3.3)
  return r;
}
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.);
  vec3 g = waves(wp.xz); wp.y += g.x;
  vWorld = wp.xyz; vN = normalize(vec3(-g.y, 1., -g.z));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const waterFrag = /* glsl */ `
uniform vec3 deep, shallow, skyCol, sunCol, sunDir, fogCol; uniform float fogD, uTime;
varying vec3 vWorld; varying vec3 vN;
void main(){
  vec3 n = vN;
  n.xz += .07 * vec2(sin(vWorld.x*3.1 + uTime*2.), cos(vWorld.z*2.7 - uTime*1.7));
  n = normalize(n);
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1. - max(dot(n, v), 0.), 4.) * .85 + .06;
  float r = length(vWorld.xz);
  vec3 c = mix(deep, shallow, smoothstep(48., 27., r) * .85 + .1);
  c = mix(c, skyCol, fres);
  vec3 h = normalize(normalize(sunDir) + v);
  c += sunCol * pow(max(dot(n, h), 0.), 260.) * 4.;
  float foam = smoothstep(1.1, 0., abs(r - 27.6 + .45*sin(uTime*1.3 + atan(vWorld.z, vWorld.x)*7.)));
  c = mix(c, vec3(.92, .94, .95), foam * .55);
  float dist = length(cameraPosition - vWorld);
  c = mix(c, fogCol, 1. - exp(-pow(fogD * dist, 2.)));
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createWorld(scene) {
  const rand = rng(20261118);
  const P = {}; // 当前插值中的环境参数
  for (const [k, v] of Object.entries(PRESETS.dusk)) P[k] = v.isColor ? v.clone() : v;
  let target = PRESETS.dusk;

  scene.fog = new THREE.FogExp2(P.fog.clone(), P.fogD);

  /* 天空 + 星星 */
  const skyGroup = new THREE.Group();
  scene.add(skyGroup);
  const skyU = {
    top: { value: P.top }, horizon: { value: P.horizon }, bottom: { value: P.bottom },
    discColor: { value: P.discColor }, discDir: { value: new THREE.Vector3() }, discSize: { value: P.discSize },
  };
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(500, 48, 24),
    new THREE.ShaderMaterial({ uniforms: skyU, vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false })
  );
  sky.renderOrder = -1;
  skyGroup.add(sky);
  const starPos = [];
  for (let i = 0; i < 1600; i++) {
    const u = rand() * Math.PI * 2, y = rand() * 0.95 + 0.05, rr = Math.sqrt(1 - y * y);
    starPos.push(Math.cos(u) * rr * 450, y * 450, Math.sin(u) * rr * 450);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  skyGroup.add(new THREE.Points(starGeo, starMat));

  /* 灯光 */
  const hemi = new THREE.HemisphereLight(P.hemiSky, P.hemiGround, P.hemiI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(P.light, P.lightI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 60 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  scene.add(sun, sun.target);

  /* 海面 */
  const waterGeo = new THREE.PlaneGeometry(900, 900, 220, 220);
  waterGeo.rotateX(-Math.PI / 2);
  const waterU = {
    uTime: { value: 0 }, deep: { value: P.deep }, shallow: { value: P.shallow }, skyCol: { value: P.horizon },
    sunCol: { value: P.light }, sunDir: { value: new THREE.Vector3() }, fogCol: { value: P.fog }, fogD: { value: P.fogD },
  };
  const water = new THREE.Mesh(waterGeo, new THREE.ShaderMaterial({ uniforms: waterU, vertexShader: waterVert, fragmentShader: waterFrag }));
  water.position.y = -0.35;
  scene.add(water);

  /* 岛屿：沙滩 → 环形车道 → 草坪 */
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...o });
  const island = new THREE.Mesh(new THREE.CylinderGeometry(ISLAND_R, ISLAND_R + 6, 1.2, 96), std('#e2c99a'));
  island.position.y = -0.6;
  island.receiveShadow = true;
  scene.add(island);
  const flat = (geo, m, y) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };
  flat(new THREE.RingGeometry(TRACK_R - 1.6, TRACK_R + 1.6, 160), std('#3a3940', { roughness: 0.85 }), 0.012);
  flat(new THREE.RingGeometry(TRACK_R + 1.6, TRACK_R + 1.85, 160), std('#d9d4c7'), 0.014);
  flat(new THREE.RingGeometry(TRACK_R - 1.85, TRACK_R - 1.6, 160), std('#d9d4c7'), 0.014);
  flat(new THREE.CircleGeometry(TRACK_R - 1.85, 96), std('#5f8a4a'), 0.01);
  const dashMat = std('#f2d36b', { emissive: '#3a2f08' });
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.7), dashMat);
    d.position.set(Math.cos(a) * TRACK_R, 0.02, Math.sin(a) * TRACK_R);
    d.rotation.y = -a;
    scene.add(d);
  }

  /* 灯塔（中心地标），夜里光束扫过 */
  const lighthouse = new THREE.Group();
  scene.add(lighthouse);
  const red = std('#c2362f', { roughness: 0.6 }), white = std('#f1ece2', { roughness: 0.6 });
  for (let i = 0; i < 6; i++) {
    const r0 = 1.15 - i * 0.07, r1 = 1.15 - (i + 1) * 0.07;
    const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1.4, 32), i % 2 ? white : red);
    seg.position.y = 0.7 + i * 1.4;
    seg.castShadow = seg.receiveShadow = true;
    lighthouse.add(seg);
  }
  const gallery = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.15, 32), std('#2b2b30'));
  gallery.position.y = 8.5;
  const glassMat = new THREE.MeshStandardMaterial({ color: '#fff3c0', emissive: '#ffdf8a', emissiveIntensity: 0.4 });
  const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.9, 24), glassMat);
  glass.position.y = 9.05;
  const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.8, 24), red);
  roof.position.y = 9.9;
  lighthouse.add(gallery, glass, roof);
  const beam = new THREE.Group();
  beam.position.y = 9.05;
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ffe7a6', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  for (const s of [1, -1]) {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(4, 40, 32, 1, true), beamMat);
    cone.rotation.z = (s * Math.PI) / 2;
    cone.position.x = -s * 20;
    beam.add(cone);
  }
  lighthouse.add(beam);

  /* 路灯 */
  const lampMat = new THREE.MeshStandardMaterial({ color: '#fff0c8', emissive: '#ffd27a', emissiveIntensity: 0 });
  const poleMat = std('#2c2f36', { metalness: 0.6, roughness: 0.4 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.17;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * (TRACK_R + 2.4), 0, Math.sin(a) * (TRACK_R + 2.4));
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 3.2, 10), poleMat);
    pole.position.y = 1.6;
    pole.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), lampMat);
    bulb.position.y = 3.3;
    g.add(pole, bulb);
    scene.add(g);
  }

  /* 棕榈树 */
  const trunkMat = std('#8a6a48'), frondMat = std('#3f7a3a', { side: THREE.DoubleSide }), nutMat = std('#5a3d22');
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2, r = 18.5 + rand() * 5;
    const g = new THREE.Group();
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    g.rotation.y = rand() * Math.PI * 2;
    const h = 4 + rand() * 2, bend = 0.6 + rand() * 0.8;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(bend * 0.2, h * 0.35, 0),
      new THREE.Vector3(bend * 0.6, h * 0.7, 0), new THREE.Vector3(bend, h, 0),
    ]);
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.16, 8), trunkMat);
    trunk.castShadow = true;
    g.add(trunk);
    const crown = new THREE.Group();
    crown.position.set(bend, h, 0);
    for (let k = 0; k < 8; k++) {
      const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.35, 2.6, 4, 1), frondMat);
      leaf.scale.z = 0.12;
      leaf.geometry.translate(0, 1.3, 0);
      leaf.rotation.set(0, (k / 8) * Math.PI * 2, 1.15 + rand() * 0.35, 'YXZ');
      leaf.castShadow = true;
      crown.add(leaf);
    }
    for (let k = 0; k < 3; k++) {
      const nut = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), nutMat);
      nut.position.set(Math.cos(k * 2.1) * 0.18, -0.15, Math.sin(k * 2.1) * 0.18);
      crown.add(nut);
    }
    g.add(crown);
    scene.add(g);
  }

  /* 礁石 */
  const rockMat = std('#7d7a76', { flatShading: true });
  for (let i = 0; i < 16; i++) {
    const a = rand() * Math.PI * 2, r = 26 + rand() * 3;
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + rand() * 0.9, 0), rockMat);
    rock.position.set(Math.cos(a) * r, -0.3, Math.sin(a) * r);
    rock.rotation.set(rand() * 3, rand() * 3, rand() * 3);
    rock.castShadow = rock.receiveShadow = true;
    scene.add(rock);
  }

  /* 远处帆船 */
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.6, 1.1), std('#f4efe6'));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4.4, 6), std('#5a4636'));
  mast.position.y = 2.4;
  const sailShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 3.8), new THREE.Vector2(-2.2, 0)]);
  const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), std('#e9603f', { side: THREE.DoubleSide }));
  sail.position.set(0.05, 0.5, 0);
  boat.add(hull, mast, sail);
  scene.add(boat);

  /* 白云 */
  const cloudMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  const clouds = [];
  for (let i = 0; i < 10; i++) {
    const g = new THREE.Group();
    for (let k = 0; k < 6; k++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(4 + rand() * 4, 14, 10), cloudMat);
      puff.position.set((k - 2.5) * 4.5 + rand() * 2, rand() * 2.5, rand() * 4);
      puff.scale.y = 0.6;
      g.add(puff);
    }
    const a = rand() * Math.PI * 2, r = 130 + rand() * 90;
    g.position.set(Math.cos(a) * r, 38 + rand() * 25, Math.sin(a) * r);
    g.lookAt(0, g.position.y, 0);
    clouds.push({ g, a, r, s: 0.004 + rand() * 0.004 });
    scene.add(g);
  }

  /* 海鸥 */
  const gullMat = std('#f5f5f2', { side: THREE.DoubleSide });
  const gulls = [];
  for (let i = 0; i < 7; i++) {
    const g = new THREE.Group();
    const wingGeo = new THREE.PlaneGeometry(0.9, 0.22);
    wingGeo.rotateX(-Math.PI / 2);
    wingGeo.translate(0.45, 0, 0);
    const wl = new THREE.Mesh(wingGeo, gullMat);
    const wr = new THREE.Mesh(wingGeo, gullMat);
    wr.scale.x = -1;
    const torsoG = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.35, 4, 8), gullMat);
    torsoG.rotation.x = Math.PI / 2;
    g.add(wl, wr, torsoG);
    scene.add(g);
    gulls.push({ g, wl, wr, r: 18 + rand() * 18, h: 11 + rand() * 8, a: rand() * Math.PI * 2, s: 0.18 + rand() * 0.12, f: 5 + rand() * 3 });
  }

  const dirFrom = (elev, az, out) => out.set(Math.cos(elev) * Math.cos(az), Math.sin(elev), Math.cos(elev) * Math.sin(az));
  const discDir = new THREE.Vector3(), lightDir = new THREE.Vector3();

  function setPreset(name) {
    target = PRESETS[name];
  }

  function update(t, dt, focus, camera) {
    const k = 1 - Math.exp(-dt * 2.2);
    for (const [key, v] of Object.entries(target)) {
      if (v.isColor) P[key].lerp(v, k);
      else P[key] += (v - P[key]) * k;
    }
    dirFrom(P.elev, P.az, discDir);
    dirFrom(Math.max(P.elev, 0.16), P.az, lightDir);

    skyU.discDir.value.copy(discDir);
    skyU.discSize.value = P.discSize;
    starMat.opacity = P.stars;
    skyGroup.position.copy(camera.position);

    hemi.color.copy(P.hemiSky);
    hemi.groundColor.copy(P.hemiGround);
    hemi.intensity = P.hemiI;
    sun.color.copy(P.light);
    sun.intensity = P.lightI;
    sun.position.copy(focus).addScaledVector(lightDir, 30);
    sun.target.position.copy(focus);

    scene.fog.color.copy(P.fog);
    scene.fog.density = P.fogD;
    waterU.uTime.value = t;
    waterU.fogD.value = P.fogD;
    waterU.sunDir.value.copy(discDir);

    lampMat.emissiveIntensity = P.lamp * 5;
    glassMat.emissiveIntensity = 0.4 + P.beam * 4;
    beamMat.opacity = P.beam * 0.16;
    beam.rotation.y = t * 0.6;

    const ba = t * 0.012;
    boat.position.set(Math.cos(ba) * 85, -0.2 + Math.sin(t * 0.9) * 0.15, Math.sin(ba) * 85);
    boat.rotation.set(Math.sin(t * 0.7) * 0.05, -ba, Math.sin(t * 0.9) * 0.06);

    for (const c of clouds) {
      c.a += c.s * dt;
      c.g.position.x = Math.cos(c.a) * c.r;
      c.g.position.z = Math.sin(c.a) * c.r;
    }
    for (const g of gulls) {
      g.a += g.s * dt;
      g.g.position.set(Math.cos(g.a) * g.r, g.h + Math.sin(t * 0.5 + g.r) * 1.2, Math.sin(g.a) * g.r);
      g.g.rotation.y = -g.a;
      g.g.rotation.z = -0.25;
      const flap = Math.sin(t * g.f) * 0.6;
      g.wl.rotation.z = flap;
      g.wr.rotation.z = -flap;
    }
  }

  return { setPreset, update, P, sun };
}
