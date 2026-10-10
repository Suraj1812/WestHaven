import * as THREE from './vendor/three.module.js';

const geometryCache = new Map();
const materialCache = new Map();
const cached = (key, make) => {
  if (!geometryCache.has(key)) geometryCache.set(key, make());
  return geometryCache.get(key);
};
const material = (color, roughness = .35, metalness = .5, extra = {}) => {
  const key = JSON.stringify([color, roughness, metalness, extra]);
  if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
  return materialCache.get(key);
};
const sphere = cached('sphere', () => new THREE.SphereGeometry(1, 16, 12));
const cube = cached('cube', () => new THREE.BoxGeometry(1, 1, 1));
const capsule = (radius, length) => cached(`capsule:${radius}:${length}`, () => new THREE.CapsuleGeometry(radius, length, 6, 12));

function transformed(source, position = [0, 0, 0], scale = [1, 1, 1], rotation = [0, 0, 0]) {
  const g = source.clone();
  g.scale(...scale);
  g.rotateX(rotation[0]); g.rotateY(rotation[1]); g.rotateZ(rotation[2]);
  g.translate(...position);
  return g;
}

// Merge disconnected anatomical/armor surfaces, retaining their smooth normals.
function merged(parts) {
  const positions = [], normals = [], indices = [];
  let offset = 0;
  for (const part of parts) {
    positions.push(...part.attributes.position.array);
    normals.push(...part.attributes.normal.array);
    if (part.index) indices.push(...Array.from(part.index.array, n => n + offset));
    else for (let i = 0; i < part.attributes.position.count; i++) indices.push(offset + i);
    offset += part.attributes.position.count;
    part.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  g.computeBoundingSphere();
  return g;
}

// Elliptical cross sections give the chest, pelvis, thighs and cowl a human taper.
function sculpt(rings, segments = 16) {
  const positions = [], indices = [];
  const ascending = rings[rings.length - 1][0] > rings[0][0];
  for (const [y, rx, rz, z = 0] of rings) {
    for (let j = 0; j <= segments; j++) {
      const angle = j / segments * Math.PI * 2;
      positions.push(Math.cos(angle) * rx, y, Math.sin(angle) * rz + z);
    }
  }
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j, b = a + segments + 1;
      if (ascending) indices.push(a, b, a + 1, a + 1, b, b + 1);
      else indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  for (const [ring, reverse] of [[0, ascending], [rings.length - 1, !ascending]]) {
    const center = positions.length / 3;
    positions.push(0, rings[ring][0], rings[ring][3] || 0);
    for (let j = 0; j < segments; j++) {
      const a = ring * (segments + 1) + j;
      if (reverse) indices.push(center, a, a + 1);
      else indices.push(center, a + 1, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices); g.computeVertexNormals();
  return g;
}

function plate(points, thickness = .012) {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => i ? shape.lineTo(x, y) : shape.moveTo(x, y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: thickness, steps: 1, bevelEnabled: true,
    bevelSize: .004, bevelThickness: .004, bevelSegments: 1, curveSegments: 1,
  });
}

function add(parent, geometry, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

const heroTorso = cached('hero:torso', () => sculpt([
  [0, .145, .085], [.10, .172, .091], [.22, .218, .113],
  [.34, .252, .125], [.425, .247, .115], [.48, .106, .074],
]));
const heroPelvis = cached('hero:pelvis', () => sculpt([
  [0, .11, .085], [.04, .162, .098], [.125, .166, .099], [.17, .147, .086],
]));
const cowl = cached('hero:cowl', () => merged([
  sculpt([[-.12,.054,.065],[-.083,.077,.082],[-.008,.091,.085],[.071,.088,.088],[.118,.063,.065],[.137,.014,.019]], 20),
  transformed(plate([[-.018,.045],[.018,.045],[.014,-.04],[0,-.065],[-.014,-.04]], .012), [0,0,-.095]),
]));
const eyeGeometry = cached('hero:eyes', () => {
  const g = new THREE.BufferGeometry();
  const p = [-.077,.028,-.069,-.021,.022,-.093,-.025,.005,-.093,-.071,.012,-.075,
    .077,.028,-.069,.071,.012,-.075,.025,.005,-.093,.021,.022,-.093];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex([0,3,2,0,2,1,4,7,6,4,6,5]); g.computeVertexNormals();
  return g;
});

function upperArm(armored) {
  return cached(`arm:upper:${armored}`, () => merged([
    transformed(capsule(armored ? .059 : .052, .19), [0,-.143,0], [1,1, .94]),
    transformed(sphere, [0,-.018,.006], [armored ? .085 : .062, armored ? .083 : .065, armored ? .08 : .062]),
    ...(armored ? [transformed(cube, [0,-.035,-.055], [.112,.064,.032], [0,0,-.10])] : []),
  ]));
}

function lowerArm(armored) {
  return cached(`arm:lower:${armored}`, () => merged([
    sculpt([[.012,.044,.044],[-.05,.053,.049],[-.16,.041,.040],[-.222,.033,.034]], 12),
    transformed(sphere, [0,-.275,-.008], [armored ? .052 : .039,.075,armored ? .052 : .037]),
    ...(armored ? [transformed(cube, [0,-.107,-.041], [.069,.15,.018]),
      transformed(cube, [0,-.286,-.054], [.069,.034,.016])] : []),
  ]));
}

function upperLeg(armored) {
  return cached(`leg:upper:${armored}`, () => sculpt([
    [.018,armored ? .073 : .061,.073],[-.08,armored ? .084 : .069,.073],
    [-.25,armored ? .069 : .057,.063],[-.39,.053,.053],
  ], 14));
}

function lowerLeg(armored) {
  return cached(`leg:lower:${armored}`, () => merged([
    sculpt([[.01,.054,.055],[-.115,armored ? .065 : .052,.058],[-.27,.043,.046],[-.405,.041,.043]],14),
    transformed(capsule(.06,.14), [0,-.505,-.055], [1,1,.75], [Math.PI / 2,0,0]),
    ...(armored ? [transformed(sphere, [0,-.027,-.038], [.062,.07,.032]),
      transformed(cube, [0,-.188,-.050], [.068,.20,.024]),
      transformed(sphere, [0,-.386,0], [.055,.105,.052])] : []),
  ]));
}

function makeRig(group, armored, mats) {
  const rig = new THREE.Group(); rig.position.y = .94; group.add(rig);
  const joints = { rig, shoulders: [], elbows: [], hips: [], knees: [] };
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * (armored ? .265 : .225), .485, 0); rig.add(shoulder);
    add(shoulder, upperArm(armored), mats.sleeve);
    const elbow = new THREE.Group(); elbow.position.y = -.30; shoulder.add(elbow);
    add(elbow, lowerArm(armored), mats.forearm);
    const hip = new THREE.Group(); hip.position.set(side * .098, 0, 0); rig.add(hip);
    add(hip, upperLeg(armored), mats.pants);
    const knee = new THREE.Group(); knee.position.y = -.39; hip.add(knee);
    add(knee, lowerLeg(armored), mats.boots);
    joints.shoulders.push(shoulder); joints.elbows.push(elbow);
    joints.hips.push(hip); joints.knees.push(knee);
  }
  return joints;
}

function animator(joints, cape, heroic = false) {
  let previousTime, phase = 0, flightBlend = 0;
  return (time = 0, speed = 0, flying = false) => {
    time = Number.isFinite(time) ? time : 0;
    speed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    const dt = previousTime === undefined ? 1 / 60 : THREE.MathUtils.clamp(time - previousTime, 0, .1);
    previousTime = time;
    phase += dt * (5.4 + Math.min(speed, 12) * .82);
    flightBlend = THREE.MathUtils.damp(flightBlend, heroic && flying ? 1 : 0, 9, dt);
    const stride = Math.min(speed / (heroic ? 4 : 1.4), 1) * (heroic ? .64 : .48);
    const grounded = 1 - flightBlend;
    joints.rig.position.y = .94 + Math.abs(Math.sin(phase * 2)) * stride * .045 * grounded;
    joints.rig.rotation.set(THREE.MathUtils.lerp(-stride * .12, -Math.PI / 2 + .05, flightBlend), 0, 0);
    for (let i = 0; i < 2; i++) {
      const step = Math.sin(phase + i * Math.PI);
      joints.hips[i].rotation.set(step * stride * grounded, 0, (i ? 1 : -1) * .025);
      joints.knees[i].rotation.set(-Math.max(0, -step) * stride * .90 * grounded - flightBlend * .10, 0, 0);
      joints.shoulders[i].rotation.set(THREE.MathUtils.lerp(-step * stride * .7, 2.95, flightBlend), 0,
        (i ? 1 : -1) * THREE.MathUtils.lerp(.075, .055, flightBlend));
      joints.elbows[i].rotation.set(.12 * grounded + Math.max(0, step) * stride * .28 * grounded + flightBlend * .04, 0, 0);
    }
    if (cape) {
      const position = cape.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        const u = (i % 8) / 7, v = Math.floor(i / 8) / 8;
        const width = THREE.MathUtils.lerp(.34, .83, Math.pow(v, .7));
        const flutter = Math.sin(time * (3.1 + Math.min(speed, 12) * .18) - v * 5.2 + u * 3.6);
        position.setXYZ(i, (u - .5) * width,
          .485 - v * (1.02 + flightBlend * .12),
          .106 + v * (.13 + flightBlend * .24) + flutter * v * (.025 + Math.min(speed, 10) * .004));
      }
      position.needsUpdate = true;
      cape.geometry.computeVertexNormals();
    }
  };
}

export function createHero() {
  const group = new THREE.Group(); group.name = 'Sentinel';
  const graphite = material('#222b32', .35, .5);
  const armor = material('#3b454c', .31, .58);
  const black = material('#141c24', .46, .32);
  const gold = material('#c2a369', .30, .72);
  const joints = makeRig(group, true, { sleeve: armor, forearm: graphite, pants: graphite, boots: black });
  const rig = joints.rig;
  add(rig, heroTorso, graphite, 0, .06, 0);
  add(rig, heroPelvis, black, 0, -.07, 0);
  add(rig, cached('hero:neck', () => transformed(capsule(.053,.035), [0,0,0], [1,1,.95])), black, 0, .584, 0);
  const head = new THREE.Group(); head.position.set(0,.716,0); rig.add(head); joints.head = head;
  add(head, cowl, black);
  add(head, eyeGeometry, material('#e2f1eb', .3, .35, { emissive:'#c5e3e4', emissiveIntensity:.8, side:THREE.DoubleSide }));
  add(head, cached('hero:jaw', () => plate([[-.062,-.056],[-.047,-.103],[0,-.124],[.047,-.103],[.062,-.056],[.027,-.07],[-.027,-.07]],.006)), armor, 0,0,-.079);
  const chest = cached('hero:chest', () => {
    const points = [[-.13,-.05],[-.105,.071],[-.047,.102],[.073,.071],[.076,-.036],[.045,-.088],[-.06,-.09]];
    const left = transformed(plate(points,.014), [-.108,.337,-.134]);
    const right = transformed(plate(points.map(([x,y]) => [-x,y]), .014), [.108,.337,-.134]);
    return merged([left,right]);
  });
  add(rig, chest, armor);
  add(rig, cached('hero:belt', () => merged([
    transformed(cube,[0,.079,-.093],[.285,.023,.022]),
    transformed(cube,[0,.079,-.109],[.049,.034,.008]),
  ])), gold);
  add(rig, cached('hero:emblem', () => merged([
    transformed(plate([[-.066,.047],[0,.011],[.066,.047],[.048,.002],[0,-.042],[-.048,.002]],.009),[0,.336,-.163]),
    transformed(sphere,[-.147,.467,-.071],[.023,.021,.012]),
    transformed(sphere,[.147,.467,-.071],[.023,.021,.012]),
    transformed(cube,[-.182,.427,-.118],[.105,.012,.010],[0,0,-.11]),
    transformed(cube,[.182,.427,-.118],[.105,.012,.010],[0,0,.11]),
  ])), gold);
  const capeGeometry = new THREE.PlaneGeometry(1,1,7,8);
  const cape = add(rig, capeGeometry, material('#702c38',.84,.02,{side:THREE.DoubleSide}));
  cape.name = 'Flowing crimson cape'; cape.frustumCulled = false;
  joints.cape = cape;
  const animate = animator(joints, cape, true);
  animate(0,0,false);
  return { group, joints, animate };
}

export function createNPC(index = 0) {
  const group = new THREE.Group(); group.name = 'Citizen'; group.scale.setScalar(1.65 / 1.8);
  const i = Math.abs(Math.trunc(index)) % 6;
  const clothes = ['#505c60','#484d5d','#61594f','#4e605b','#625255','#59626b'];
  const trousers = ['#292f38','#33383c','#343631','#2c3435','#34313a','#343943'];
  const skins = ['#b3947f','#9b7b65','#c4a58c','#806552','#bd9981','#a88670'];
  const skin = material(skins[i],.83,0);
  const shirt = material(clothes[i],.86,.01);
  const pants = material(trousers[i],.88,.01);
  const joints = makeRig(group,false,{sleeve:shirt,forearm:skin,pants,boots:pants});
  const rig = joints.rig;
  add(rig, cached(`npc:torso:${i % 2}`, () => {
    const body = sculpt([[0,.135,.089],[.13,.158,.089],[.30,.18,.098],[.50,.211,.107],[.59,.079,.063]],16);
    if (i % 2) return merged([body,transformed(sphere,[0,.31,.098],[.128,.20,.061])]);
    return body;
  }), shirt, 0,-.064,0);
  const head = new THREE.Group(); head.position.set(0,.716,0); rig.add(head);
  add(head,cached('npc:head', () => merged([
    transformed(sphere,[0,0,0],[.086,.122,.083]),
    transformed(sphere,[0,-.022,-.082],[.017,.027,.020]),
    transformed(capsule(.043,.035),[0,-.135,0]),
  ])),skin);
  add(head,cached('npc:hair-eyes', () => merged([
    transformed(new THREE.SphereGeometry(1,16,8,0,Math.PI*2,0,1.5),[0,.012,.003],[.090,.117,.087]),
    transformed(sphere,[-.033,.013,-.077],[.007,.004,.004]),
    transformed(sphere,[.033,.013,-.077],[.007,.004,.004]),
  ])),material(i === 2 ? '#7b7870' : '#282829',.9,0));
  const animate = animator(joints,null,false);
  animate(0,0,false);
  return { group, animate };
}
