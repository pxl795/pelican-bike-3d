import * as THREE from 'three';

const V = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 14);
const sphGeo = new THREE.SphereGeometry(0.5, 28, 20);

// 将单位圆柱/球拉伸到 a→b 两点之间，用于车架、腿、翅膀等所有"杆状"部件
export function orient(mesh, a, b, rx, rz = rx) {
  const d = b.clone().sub(a);
  const len = d.length();
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(UP, d.normalize());
  mesh.scale.set(rx, len, rz);
  return mesh;
}

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...o });

export const BIKE = {
  wheelR: 0.35,
  crank: 0.17,
  chainring: 44,
  cog: 20,
  bb: V(0, 0.3),
  rear: V(-0.52, 0.35),
  front: V(0.55, 0.35),
};

// 两段骨骼 IK（在 xy 平面内），膝盖朝前
function solveKnee(hip, foot, l1, l2, out) {
  const dx = foot.x - hip.x, dy = foot.y - hip.y;
  const d = THREE.MathUtils.clamp(Math.hypot(dx, dy), Math.abs(l1 - l2) + 1e-3, l1 + l2 - 1e-3);
  const a = Math.atan2(dy, dx);
  const A = Math.acos((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d));
  return out.set(hip.x + l1 * Math.cos(a + A), hip.y + l1 * Math.sin(a + A), hip.z);
}

export function createRider() {
  const M = {
    paint: mat('#127a7f', { metalness: 0.55, roughness: 0.32 }),
    chrome: mat('#dfe3e6', { metalness: 1, roughness: 0.18 }),
    rubber: mat('#18181c', { roughness: 0.92 }),
    saddle: mat('#5a2f1e', { roughness: 0.65 }),
    wicker: mat('#a9773f', { roughness: 0.9, side: THREE.DoubleSide }),
    feather: mat('#8b7b69', { roughness: 0.85 }),
    featherDark: mat('#4d453e', { roughness: 0.9 }),
    white: mat('#f4f0e6', { roughness: 0.8 }),
    head: mat('#f0d98a', { roughness: 0.7 }),
    beak: mat('#cfae80', { roughness: 0.45 }),
    beakTip: mat('#e8742c', { roughness: 0.4 }),
    pouch: mat('#e2875a', { roughness: 0.55 }),
    leg: mat('#45444a', { roughness: 0.7 }),
    eye: mat('#fff6dc', { roughness: 0.2 }),
    pupil: mat('#0c0c0e', { roughness: 0.1 }),
    lens: new THREE.MeshStandardMaterial({ color: '#fff3c4', emissive: '#ffe8a8', emissiveIntensity: 0 }),
  };

  const root = new THREE.Group();
  const lean = new THREE.Group();
  root.add(lean);
  const add = (m, parent = lean) => (parent.add(m), m);
  const cyl = (m) => new THREE.Mesh(cylGeo, m);
  const ell = (m) => new THREE.Mesh(sphGeo, m);

  /* ---------- 自行车 ---------- */
  const R = BIKE.wheelR;
  function makeWheel() {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.028, 12, 72), M.rubber));
    g.add(new THREE.Mesh(new THREE.TorusGeometry(R - 0.032, 0.011, 8, 72), M.chrome));
    const hub = cyl(M.chrome);
    hub.scale.set(0.025, 0.1, 0.025);
    hub.rotation.x = Math.PI / 2;
    g.add(hub);
    const pts = [];
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const z = i % 2 ? 0.035 : -0.035;
      pts.push(0, 0, z, Math.cos(a) * (R - 0.04), Math.sin(a) * (R - 0.04), 0);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.add(new THREE.LineSegments(sg, new THREE.LineBasicMaterial({ color: '#c9ced3' })));
    return g;
  }
  const rearWheel = add(makeWheel());
  rearWheel.position.copy(BIKE.rear);
  const frontWheel = add(makeWheel());
  frontWheel.position.copy(BIKE.front);

  const seatTop = V(-0.17, 0.86), headTop = V(0.47, 0.86), headBot = V(0.5, 0.72);
  const tube = (a, b, r = 0.019, m = M.paint) => add(orient(cyl(m), a, b, r));
  tube(BIKE.bb, seatTop);
  tube(seatTop, headTop, 0.017);
  tube(BIKE.bb, headBot, 0.022);
  tube(headBot, headTop.clone().setY(0.9), 0.026);
  for (const z of [-0.055, 0.055]) {
    tube(V(0, 0.3, z * 0.6), V(-0.52, 0.35, z), 0.011);
    tube(V(-0.16, 0.84, z * 0.4), V(-0.52, 0.35, z), 0.011);
    tube(V(0.5, 0.72, z * 0.5), V(0.55, 0.35, z), 0.013);
  }
  tube(V(-0.17, 0.86), V(-0.2, 0.92), 0.013, M.chrome);
  const saddle = add(ell(M.saddle));
  saddle.position.set(-0.21, 0.935, 0);
  saddle.scale.set(0.27, 0.055, 0.14);
  tube(V(0.48, 0.9), V(0.5, 0.98), 0.014, M.chrome);
  tube(V(0.5, 0.98, -0.25), V(0.5, 0.98, 0.25), 0.012, M.chrome);
  for (const z of [-1, 1]) tube(V(0.5, 0.98, z * 0.17), V(0.5, 0.98, z * 0.26), 0.02, M.rubber);

  const basket = add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.14, 0.17, 20, 3, true), M.wicker));
  basket.position.set(0.7, 0.92, 0);
  const basketBottom = add(new THREE.Mesh(new THREE.CircleGeometry(0.14, 20), M.wicker));
  basketBottom.rotation.x = -Math.PI / 2;
  basketBottom.position.set(0.7, 0.835, 0);

  const lamp = add(new THREE.Mesh(new THREE.SphereGeometry(0.035, 16, 12), M.lens));
  lamp.position.set(0.56, 0.92, 0);
  const headlight = new THREE.SpotLight('#ffe9b8', 0, 26, 0.48, 0.6, 1.4);
  headlight.position.set(0.58, 0.92, 0);
  headlight.target.position.set(5, -0.2, 0);
  lean.add(headlight, headlight.target);

  // 链盘、飞轮、链条
  const ring = add(new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.008, 8, 40), M.chrome));
  ring.position.set(0, 0.3, 0.07);
  const cog = add(new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.007, 8, 28), M.chrome));
  cog.position.set(-0.52, 0.35, 0.07);
  tube(V(0, 0.395, 0.07), V(-0.52, 0.395, 0.07), 0.005, M.rubber);
  tube(V(0, 0.205, 0.07), V(-0.52, 0.305, 0.07), 0.005, M.rubber);

  const crank = add(new THREE.Group());
  crank.position.copy(BIKE.bb);
  for (const s of [1, -1]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(BIKE.crank, 0.022, 0.012), M.chrome);
    arm.position.set((s * BIKE.crank) / 2, 0, s * 0.1);
    crank.add(arm);
  }
  const pedals = [1, -1].map(() => {
    const p = add(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.018, 0.08), M.rubber));
    return p;
  });

  /* ---------- 鹈鹕 ---------- */
  const torso = add(new THREE.Group());
  const body = add(ell(M.feather), torso);
  body.position.set(-0.13, 1.17, 0);
  body.scale.set(0.74, 0.48, 0.46);
  body.rotation.z = 0.32;
  const chest = add(ell(M.white), torso);
  chest.position.set(0.0, 1.22, 0);
  chest.scale.set(0.34, 0.4, 0.34);
  chest.rotation.z = 0.5;
  const tail = add(new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.3, 10), M.featherDark), torso);
  tail.position.set(-0.5, 1.03, 0);
  tail.rotation.z = Math.PI / 2 + 0.35;
  tail.scale.z = 0.5;

  const neckCurve = new THREE.CatmullRomCurve3([V(0.04, 1.3), V(0.15, 1.48), V(0.05, 1.64), V(0.1, 1.8)]);
  add(new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 32, 0.055, 12), M.white), torso);
  const neckBack = add(new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 32, 0.05, 12), M.featherDark), torso);
  neckBack.position.x = -0.012;
  neckBack.scale.z = 0.7;

  const head = add(new THREE.Group(), torso);
  head.position.set(0.12, 1.84, 0);
  const skull = add(ell(M.head), head);
  skull.scale.set(0.2, 0.16, 0.15);
  for (const z of [-1, 1]) {
    const eye = add(new THREE.Mesh(new THREE.SphereGeometry(0.022, 14, 10), M.eye), head);
    eye.position.set(0.045, 0.02, z * 0.062);
    const pupil = add(new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), M.pupil), head);
    pupil.position.set(0.055, 0.022, z * 0.078);
  }
  const upperBill = add(ell(M.beak), head);
  orient(upperBill, V(0.05, 0.0), V(0.62, -0.13), 0.07, 0.045);
  const hook = add(new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), M.beakTip), head);
  hook.position.set(0.61, -0.135, 0);
  hook.scale.set(1.3, 1, 0.9);

  const jaw = add(new THREE.Group(), head);
  jaw.position.set(0.05, -0.035, 0);
  const lowerBill = add(ell(M.beak), jaw);
  orient(lowerBill, V(0.0, 0.0), V(0.55, -0.11), 0.05, 0.055);
  const pouch = add(ell(M.pouch), jaw);
  pouch.position.set(0.24, -0.1, 0);
  pouch.rotation.z = -0.2;
  const pouchBase = V(0.46, 0.15, 0.1);
  pouch.scale.copy(pouchBase);
  const mouth = new THREE.Object3D();
  mouth.position.set(0.3, -0.06, 0);
  jaw.add(mouth);

  // 翅膀：肩 → 肘 → 握把，外加几根初级飞羽
  const wings = [-1, 1].map((s) => {
    const upper = add(ell(M.feather));
    const fore = add(ell(M.feather));
    const prim = [0, 1, 2, 3].map(() => add(ell(M.featherDark)));
    return { s, upper, fore, prim, S: V(-0.02, 1.3, s * 0.2), G: V(0.5, 1.0, s * 0.22) };
  });

  const legs = [1, -1].map((s) => {
    const thigh = add(cyl(M.feather));
    const shin = add(cyl(M.leg));
    const knee = add(new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), M.leg));
    const foot = add(new THREE.Group());
    const shape = new THREE.Shape();
    shape.moveTo(-0.03, 0);
    shape.lineTo(0.13, -0.06);
    shape.quadraticCurveTo(0.15, 0, 0.13, 0.06);
    shape.lineTo(-0.03, 0);
    const web = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.012, bevelEnabled: false }), M.leg);
    web.rotation.x = Math.PI / 2;
    web.position.y = 0.02;
    foot.add(web);
    return { s, thigh, shin, knee, foot, hip: V(-0.08, 0.98, s * 0.095) };
  });

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = o.receiveShadow = true;
  });

  /* ---------- 每帧更新 ---------- */
  const tmpK = V(0, 0), tmpF = V(0, 0), tmpH = V(0, 0), tmpE = V(0, 0), tmpG = V(0, 0), tmpS = V(0, 0);
  const waveG = V(0.2, 1.78, -0.52), waveE = V(0.08, 1.48, -0.46);

  function update(st) {
    const { wheelAngle, crankAngle, t, wave = 0, open = 0, bulge = 0, night = 0 } = st;
    rearWheel.rotation.z = frontWheel.rotation.z = -wheelAngle;
    crank.rotation.z = -crankAngle;
    const bob = 0.012 * Math.sin(crankAngle * 2);
    torso.position.y = bob;

    legs.forEach((L, i) => {
      const c = -crankAngle + (i ? Math.PI : 0);
      tmpF.set(BIKE.bb.x + Math.cos(c) * BIKE.crank, BIKE.bb.y + Math.sin(c) * BIKE.crank, L.s * 0.13);
      pedals[i].position.copy(tmpF);
      tmpH.copy(L.hip).setY(L.hip.y + bob);
      tmpF.z = tmpH.z;
      tmpF.y += 0.02;
      solveKnee(tmpH, tmpF, 0.42, 0.44, tmpK);
      orient(L.thigh, tmpH, tmpK, 0.045);
      orient(L.shin, tmpK, tmpF, 0.018);
      L.knee.position.copy(tmpK);
      L.foot.position.copy(tmpF).setZ(L.s * 0.13);
    });

    wings.forEach((W) => {
      tmpS.copy(W.S).setY(W.S.y + bob);
      tmpG.copy(W.G);
      tmpE.lerpVectors(tmpS, tmpG, 0.45).add(V(0, 0.07, W.s * 0.12));
      if (W.s < 0 && wave > 0) {
        const w = THREE.MathUtils.smoothstep(wave, 0, 1);
        const g2 = waveG.clone();
        g2.y += 0.09 * Math.sin(t * 14);
        g2.x += 0.08 * Math.cos(t * 14);
        tmpG.lerp(g2, w);
        tmpE.lerp(waveE, w);
      }
      orient(W.upper, tmpS, tmpE, 0.15, 0.07);
      orient(W.fore, tmpE, tmpG, 0.11, 0.05);
      W.prim.forEach((p, k) => {
        const a = tmpE.clone().lerp(tmpG, 0.35 + k * 0.2);
        const b = a.clone().add(V(-0.28 + k * 0.03, -0.06 - k * 0.02, W.s * 0.03));
        orient(p, a, b, 0.05, 0.012);
      });
    });

    jaw.rotation.z = -0.55 * open;
    head.rotation.z = 0.28 * open + 0.03 * Math.sin(t * 1.3);
    head.rotation.y = 0.12 * Math.sin(t * 0.47);
    pouch.scale.set(pouchBase.x * (1 + 0.15 * bulge), pouchBase.y * (1 + 0.9 * bulge), pouchBase.z * (1 + 0.5 * bulge));

    M.lens.emissiveIntensity = night * 3;
    headlight.intensity = night * 9;
  }

  return { root, lean, update, mouth, headlight };
}
