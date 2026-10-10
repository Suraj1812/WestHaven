import * as THREE from './vendor/three.module.js';

// Every prop reuses this small geometry/material library.
const materials = new Map();
const geometries = new Map();
const material = (color, roughness = .78, metalness = 0, extra = {}) => {
  const key = JSON.stringify([color, roughness, metalness, extra]);
  if (!materials.has(key)) materials.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra }));
  return materials.get(key);
};
const geometry = (key, build) => {
  if (!geometries.has(key)) geometries.set(key, build());
  return geometries.get(key);
};
const box = (x, y, z) => geometry(`box:${x}:${y}:${z}`, () => new THREE.BoxGeometry(x, y, z));
const cylinder = (top, bottom, height, segments = 7) => geometry(`cyl:${top}:${bottom}:${height}:${segments}`, () => new THREE.CylinderGeometry(top, bottom, height, segments));
const foliage = geometry('leaf', () => new THREE.IcosahedronGeometry(1, 1));
const leafColors = ['#729378', '#819f82', '#62846a', '#93aa8c'];
const leafMaterials = leafColors.map(c => material(c));
const bark = material('#796754');
const iron = material('#3c4d48', .48, .44);
const wood = material('#a58a6c');
const darkGlass = material('#364d53', .19, .5);
const cream = material('#ede8d7');
const concrete = material('#b9b8a9');
const rubber = material('#303932', .92);
const hub = material('#b8bcb3', .32, .7);
const lampGlow = material('#ffe2ae', .5, .1, { emissive: '#ffd098', emissiveIntensity: 1.5 });

function mesh(group, shape, mat, x = 0, y = 0, z = 0, scale) {
  const node = new THREE.Mesh(shape, mat);
  node.position.set(x, y, z);
  if (scale) node.scale.set(...scale);
  node.castShadow = true;
  node.receiveShadow = true;
  group.add(node);
  return node;
}

function roundedSolid(length, width, height, radius) {
  return geometry(`rounded:${length}:${width}:${height}:${radius}`, () => {
    const s = new THREE.Shape();
    const x = -length / 2, y = -width / 2, r = radius;
    s.moveTo(x + r, y);
    s.lineTo(x + length - r, y);
    s.quadraticCurveTo(x + length, y, x + length, y + r);
    s.lineTo(x + length, y + width - r);
    s.quadraticCurveTo(x + length, y + width, x + length - r, y + width);
    s.lineTo(x + r, y + width);
    s.quadraticCurveTo(x, y + width, x, y + width - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(s, { depth: height, bevelEnabled: true, bevelSegments: 1, steps: 1, bevelSize: radius * .25, bevelThickness: radius * .25, curveSegments: 3 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, -height / 2, 0);
    return g;
  });
}

function polygon(key, vertices, indices) {
  return geometry(key, () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices.flat(), 3));
    g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  });
}

export function createTree({ size = 1, pine = false } = {}) {
  const tree = new THREE.Group();
  tree.name = pine ? 'Cypress' : 'Courtyard tree';
  mesh(tree, cylinder(.035, .06, .75), bark, 0, .375, 0);
  if (pine) {
    for (let i = 0; i < 3; i++) {
      mesh(tree, cylinder(0, .34 - i * .07, .58, 8), leafMaterials[i], 0, .72 + i * .26, 0);
    }
  } else {
    mesh(tree, foliage, leafMaterials[0], 0, 1.07, 0, [.42, .52, .39]);
    mesh(tree, foliage, leafMaterials[1], -.19, .91, .045, [.29, .36, .29]);
    mesh(tree, foliage, leafMaterials[2], .18, .93, -.06, [.3, .37, .28]);
    mesh(tree, foliage, leafMaterials[3], -.035, 1.34, -.02, [.27, .32, .27]);
  }
  tree.scale.setScalar(size);
  return tree;
}

export function createCar(color = '#9aaea6') {
  const car = new THREE.Group();
  car.name = 'Executive sedan';
  const paintKey = `car:paint:${color}`;
  if (!materials.has(paintKey)) materials.set(paintKey, new THREE.MeshPhysicalMaterial({
    color, roughness: .24, metalness: .45, clearcoat: 1, clearcoatRoughness: .09,
  }));
  const paint = materials.get(paintKey);
  if (!materials.has('car:glass')) materials.set('car:glass', new THREE.MeshPhysicalMaterial({
    color: '#18232e', roughness: .085, metalness: .12, clearcoat: 1, clearcoatRoughness: .06,
  }));
  const glass = materials.get('car:glass');
  const trim = material('#192127', .37, .30);
  const alloy = material('#aeb9c1', .23, .88);
  const tires = material('#14191d', .94, 0);
  const headlight = material('#e5eff8', .18, .10, { emissive: '#c9e3ff', emissiveIntensity: 1.6 });
  const taillight = material('#aa2028', .22, .10, { emissive: '#e82124', emissiveIntensity: 1.2 });
  // A contoured silhouette includes genuine open wheel arches and sloping decks.
  const body = geometry('car:body:v2', () => {
    const s = new THREE.Shape();
    const radius = .088, wheelY = .083, sillY = .105;
    const angle = Math.asin((sillY - wheelY) / radius);
    s.moveTo(-.518, sillY);
    s.lineTo(-.33 - Math.cos(angle) * radius, sillY);
    s.absarc(-.33, wheelY, radius, Math.PI - angle, angle, true);
    s.lineTo(.33 - Math.cos(angle) * radius, sillY);
    s.absarc(.33, wheelY, radius, Math.PI - angle, angle, true);
    s.lineTo(.518, sillY);
    s.lineTo(.533, .145); s.lineTo(.523, .221);
    s.lineTo(.47, .233); s.lineTo(.235, .241);
    s.lineTo(-.30, .238); s.lineTo(-.476, .232);
    s.lineTo(-.531, .218); s.lineTo(-.526, .143); s.closePath();
    const g = new THREE.ExtrudeGeometry(s, {
      depth: .424, bevelEnabled: true, bevelSize: .006,
      bevelThickness: .006, bevelSegments: 2, curveSegments: 10, steps: 1,
    });
    g.translate(0, 0, -.212);
    return g;
  });
  mesh(car, body, paint);
  mesh(car, box(.88, .034, .33), trim, 0, .064, 0);
  // The broad cabin uses black reflective glass with slimmer structural pillars.
  const cabinShape = polygon('car:cabin:v2', [
    [-.305,.237,-.190], [.26,.237,-.190], [.128,.355,-.153], [-.21,.355,-.153],
    [-.305,.237,.190], [.26,.237,.190], [.128,.355,.153], [-.21,.355,.153],
  ], [0,3,2,0,2,1,4,5,6,4,6,7,0,4,7,0,7,3,1,2,6,1,6,5,3,7,6,3,6,2]);
  mesh(car, cabinShape, glass);
  mesh(car, roundedSolid(.365, .311, .008, .015), paint, -.041, .358, 0);
  for (const side of [-1, 1]) {
    const pillar = mesh(car, box(.014,.116,.018), trim, -.071,.295,side*.171);
    pillar.rotation.x = side * -.305;
    for (const [bottomX,topX] of [[.26,.128],[-.305,-.21]]) {
      const start = new THREE.Vector3(bottomX,.238,side*.191);
      const finish = new THREE.Vector3(topX,.355,side*.154);
      const direction = finish.clone().sub(start);
      const frame = mesh(car,box(.014,1,.014),paint);
      frame.position.copy(start.add(finish).multiplyScalar(.5));
      frame.scale.y = direction.length();
      frame.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
    }
    mesh(car, box(.52,.012,.013), alloy, -.022,.24,side*.197);
    mesh(car, box(.68,.009,.016), trim, -.01,.130,side*.217);
    for (const x of [-.164,.042]) mesh(car, box(.060,.012,.010), alloy, x,.212,side*.219);
    const mirror = mesh(car, roundedSolid(.061,.052,.028,.012), paint, .192,.273,side*.235);
    mirror.rotation.y = side*.12;
    mesh(car, box(.010,.020,.040), alloy, .165,.274,side*.237);
  }
  const tireGeometry = geometry('car:tire:v2', () => {
    const profile = [[.046,-.024],[.068,-.024],[.078,-.017],[.081,-.007],
      [.081,.007],[.078,.017],[.068,.024],[.046,.024]];
    const g = new THREE.LatheGeometry(profile.map(([r,z]) => new THREE.Vector2(r,z)),24);
    g.rotateX(Math.PI/2);
    return g;
  });
  const rimGeometry = geometry('car:alloy:v2', () => {
    const parts = [new THREE.TorusGeometry(.053,.004,5,24)];
    for (let i=0;i<5;i++) {
      const a=i*Math.PI*2/5;
      const spoke=box(.045,.009,.006).clone();
      spoke.rotateZ(a); spoke.translate(Math.cos(a)*.027,Math.sin(a)*.027,0);
      parts.push(spoke);
    }
    const center=cylinder(.014,.014,.011,12).clone(); center.rotateX(Math.PI/2); parts.push(center);
    const result=new THREE.BufferGeometry();
    const data={position:[],normal:[],uv:[]};
    for (const part of parts) {
      const g=part.index?part.toNonIndexed():part;
      for (const name of Object.keys(data)) data[name].push(...g.attributes[name].array);
      if (g!==part) g.dispose(); part.dispose();
    }
    for (const name of Object.keys(data)) result.setAttribute(name,new THREE.Float32BufferAttribute(data[name],name==='uv'?2:3));
    return result;
  });
  for (const x of [-.33,.33]) for (const side of [-1,1]) {
    mesh(car,tireGeometry,tires,x,.081,side*.208);
    const rim=mesh(car,rimGeometry,alloy,x,.081,side*.233);
    if(side<0)rim.rotation.y=Math.PI;
  }
  // Separate light housings and narrow emissive LEDs read well at street level.
  mesh(car,box(.018,.054,.252),trim,.532,.166,0);
  for (const y of [.151,.176]) mesh(car,box(.020,.005,.228),alloy,.544,y,0);
  mesh(car,box(.014,.021,.068),material('#c8ced0',.55,.05),.548,.126,0);
  mesh(car,box(.018,.030,.34),trim,-.534,.131,0);
  mesh(car,box(.014,.021,.068),material('#c8ced0',.55,.05),-.547,.145,0);
  for (const side of [-1,1]) {
    mesh(car,box(.019,.031,.113),trim,.525,.213,side*.144);
    mesh(car,box(.021,.010,.102),headlight,.537,.220,side*.144);
    mesh(car,box(.021,.015,.024),headlight,.537,.208,side*.186);
    mesh(car,box(.016,.025,.109),taillight,-.536,.205,side*.145);
    mesh(car,box(.018,.007,.101),taillight,-.542,.216,side*.145);
  }
  car.userData.headlights = [[.54,.215,-.144],[.54,.215,.144]];
  return car;
}

export function createBoat() {
  const boat = new THREE.Group();
  boat.name = 'Harbour launch';
  const hull = polygon('boat:hull', [
    [-1.14, .17, -.38], [.74, .17, -.38], [1.28, .17, 0], [.74, .17, .38], [-1.14, .17, .38],
    [-1.02, -.12, -.27], [.68, -.12, -.27], [1.08, -.06, 0], [.68, -.12, .27], [-1.02, -.12, .27],
  ], [0, 6, 5, 0, 1, 6, 1, 7, 6, 1, 2, 7, 2, 8, 7, 2, 3, 8, 3, 9, 8, 3, 4, 9, 4, 5, 9, 4, 0, 5, 5, 8, 9, 5, 6, 8, 6, 7, 8]);
  mesh(boat, hull, cream);
  const deck = polygon('boat:deck', [[-1.14,.18,-.38], [.74,.18,-.38], [1.28,.18,0], [.74,.18,.38], [-1.14,.18,.38]], [0, 4, 3, 0, 3, 1, 1, 3, 2]);
  mesh(boat, deck, material('#7e7462'));
  mesh(boat, roundedSolid(.91, .59, .22, .06), cream, -.22, .28, 0);
  mesh(boat, box(.58, .25, .51), darkGlass, -.16, .49, 0);
  mesh(boat, roundedSolid(.87, .65, .045, .055), cream, -.2, .64, 0);
  for (const z of [-.27, .27]) {
    for (const x of [-.49, .18]) mesh(boat, box(.028, .27, .028), cream, x, .49, z);
    mesh(boat, box(.1, .24, .028), cream, -.18, .49, z);
    mesh(boat, box(.38, .045, .08), material('#a6afa1'), -.77, .27, z * .67);
  }
  mesh(boat, box(.2, .018, .07), lampGlow, .275, .61, 0);
  mesh(boat, cylinder(.018, .018, .3, 5), iron, -.47, .81, 0);
  mesh(boat, box(.16, .014, .065), iron, -.47, .95, 0);
  // Polished bow rail stays slender at the diorama's viewing distance.
  for (const z of [-.25, .25]) mesh(boat, cylinder(.008, .008, .13, 5), hub, .65, .245, z);
  mesh(boat, box(.018, .018, .5), hub, .65, .31, 0);
  return boat;
}

export function createStreetLamp() {
  const lamp = new THREE.Group();
  lamp.name = 'Promenade lamp';
  mesh(lamp, cylinder(.036, .075, .085, 8), iron, 0, .0425, 0);
  mesh(lamp, cylinder(.018, .029, 1.54, 7), iron, 0, .815, 0);
  mesh(lamp, box(.25, .025, .025), iron, .104, 1.58, 0);
  mesh(lamp, roundedSolid(.15, .105, .04, .026), iron, .223, 1.565, 0);
  const glow = mesh(lamp, box(.105, .007, .066), lampGlow, .223, 1.54, 0);
  glow.castShadow = false;
  return lamp;
}

export function createBench() {
  const bench = new THREE.Group();
  bench.name = 'Park bench';
  for (const z of [-.115, -.035, .045, .125]) mesh(bench, box(.83, .028, .055), wood, 0, .225, z);
  for (const y of [.35, .425]) mesh(bench, box(.83, .053, .029), wood, 0, y, -.16);
  for (const x of [-.295, .295]) {
    mesh(bench, box(.028, .235, .255), iron, x, .11, 0);
    const backSupport = mesh(bench, box(.024, .29, .024), iron, x, .31, -.164);
    backSupport.rotation.x = -.075;
    mesh(bench, box(.028, .027, .23), iron, x, .305, -.01);
  }
  return bench;
}

export function createPlanter() {
  const planter = new THREE.Group();
  planter.name = 'Stone planter';
  mesh(planter, roundedSolid(.6, .45, .28, .045), concrete, 0, .14, 0);
  mesh(planter, roundedSolid(.51, .36, .015, .035), material('#6f6958'), 0, .29, 0);
  for (let i = 0; i < 3; i++) mesh(planter, foliage, leafMaterials[i], (i - 1) * .16, .34 + (i === 1 ? .03 : 0), 0, [.2, .12, .18]);
  return planter;
}
