import * as THREE from './vendor/three.module.js';

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder = new THREE.CylinderGeometry(.5, .5, 1, 12);
const crownGeometry = new THREE.IcosahedronGeometry(1, 2);
const hipGeometry = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4);
hipGeometry.rotateY(Math.PI / 4);
const gableShape = new THREE.Shape();
gableShape.moveTo(-.5, 0); gableShape.lineTo(.5, 0); gableShape.lineTo(0, 1); gableShape.closePath();
const gableGeometry = new THREE.ExtrudeGeometry(gableShape, { depth: 1, bevelEnabled: false, steps: 1 });
gableGeometry.translate(0, 0, -.5);

export function createOpenWorld({ textures = {}, facadeMaterials = {} } = {}) {
  const group = new THREE.Group(); group.name = 'Westhaven open city';
  const buildings = [], doors = [], collidersData = [], emissiveMaterials = [];
  const materialCache = new Map(), facadeCache = new Map(), signCache = new Map();
  let seed = 847203;
  const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const choose = list => list[Math.floor(random() * list.length)];
  const material = (color, roughness = .85, metalness = 0) => {
    const key = `${color}:${roughness}:${metalness}`;
    if (!materialCache.has(key)) materialCache.set(key, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
    return materialCache.get(key);
  };
  function add(parent, geometry, mat, x, y, z, sx = 1, sy = 1, sz = 1, collision = false) {
    const mesh = new THREE.Mesh(geometry, mat); mesh.position.set(x, y, z); mesh.scale.set(sx, sy, sz);
    mesh.castShadow = sy > .25; mesh.receiveShadow = true;
    if (collision) mesh.userData.collision = true;
    parent.add(mesh); return mesh;
  }
  const box = (parent, w, h, d, x, y, z, mat, collision = false) => add(parent, unitBox, mat, x, y, z, w, h, d, collision);
  const cylinder = (parent, diameter, height, x, y, z, mat, collision = false) => add(parent, unitCylinder, mat, x, y, z, diameter, height, diameter, collision);

  function canvasTexture(width, height, draw) {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    draw(canvas.getContext('2d'), width, height);
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
    return texture;
  }
  function tiledMap(texture, x, z) {
    if (!texture) return null;
    const copy = texture.clone(); copy.wrapS = copy.wrapT = THREE.RepeatWrapping; copy.repeat.set(x, z); copy.needsUpdate = true;
    return copy;
  }
  const lawnMap = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#65775b'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 5600; i++) { ctx.fillStyle = i % 3 ? 'rgba(26,48,24,.10)' : 'rgba(171,179,119,.10)'; ctx.fillRect(random() * w, random() * h, 1 + random() * 3, 1 + random() * 4); }
  });
  lawnMap.wrapS = lawnMap.wrapT = THREE.RepeatWrapping; lawnMap.repeat.set(32, 24);
  const lawn = new THREE.MeshStandardMaterial({ color: '#8b987f', map: lawnMap, roughness: 1 });
  const paving = new THREE.MeshStandardMaterial({ color: '#b1aca2', map: tiledMap(textures.limestone, 5, 5), roughness: .96 });
  const asphaltV = new THREE.MeshStandardMaterial({ color: '#42464a', map: tiledMap(textures.asphalt, 2, 150), roughness: .94 });
  const asphaltH = new THREE.MeshStandardMaterial({ color: '#42464a', map: tiledMap(textures.asphalt, 180, 2), roughness: .94 });
  const asphaltPlain = new THREE.MeshStandardMaterial({ color: '#43464a', map: tiledMap(textures.asphalt, 3, 3), roughness: .94 });
  const stone = material('#b5afa4'), iron = material('#35414a', .45, .6), wood = material('#887360');
  const white = material('#dbdcd5'), yellow = material('#c5ae75');
  const leaf = ['#52694e', '#657956', '#738064'].map(c => material(c, .98));
  const waterMaterial = new THREE.MeshPhysicalMaterial({ color: '#223f4e', roughness: .18, metalness: .25, clearcoat: 1, clearcoatRoughness: .22 });
  const lampMaterial = new THREE.MeshStandardMaterial({ color: '#fff1d7', emissive: '#ffdda3', emissiveIntensity: 2.5, roughness: .4 });
  emissiveMaterials.push(lampMaterial);
  const glass = new THREE.MeshPhysicalMaterial({ color: '#293d49', roughness: .13, metalness: .38, clearcoat: 1, clearcoatRoughness: .1 });
  const warmGlass = new THREE.MeshPhysicalMaterial({ color: '#77644e', emissive: '#ebbc78', emissiveIntensity: .55, roughness: .15, metalness: .18, clearcoat: 1 });
  emissiveMaterials.push(warmGlass);
  const roofMap = canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#b4a598'; ctx.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 16) for (let x = -16; x < w; x += 32) {
      const xx = x + (y % 32 ? 16 : 0); ctx.fillStyle = random() > .5 ? 'rgba(27,21,21,.14)' : 'rgba(240,219,186,.10)'; ctx.fillRect(xx + 1, y + 1, 30, 14);
      ctx.fillStyle = 'rgba(31,22,20,.2)'; ctx.fillRect(xx, y + 14, 32, 2);
    }
  });
  roofMap.wrapS = roofMap.wrapT = THREE.RepeatWrapping; roofMap.repeat.set(4, 5);
  const roofColors = ['#6b5147', '#575558', '#865c48', '#484e53', '#967967', '#715750', '#5e6264', '#4b5755'];
  const roofs = roofColors.map(color => new THREE.MeshStandardMaterial({ color, map: roofMap, roughness: .96 }));
  const wallColors = ['#c6bba7', '#b19985', '#a7b0ac', '#bca398', '#d0c8b8', '#9d968a', '#acb6b7', '#bcaf93'];
  const wallPlain = wallColors.map(color => material(color));
  const doorColors = ['#3b4d4c', '#785b47', '#48516a', '#6b433b', '#313b3d', '#84715c', '#374b5c', '#5a6359'];

  function facade(style, levels, columns = 3, kind = 'home') {
    const officePhoto = textures.officeFacade?.image;
    const photographic = kind === 'office' && officePhoto && officePhoto.width && officePhoto.height;
    const key = photographic ? `office-photo:${levels}` : `${style}:${levels}:${columns}:${kind}`;
    if (facadeCache.has(key)) return facadeCache.get(key);
    const windowCanvas = document.createElement('canvas'); windowCanvas.width = 512; windowCanvas.height = Math.max(256, Math.min(2048, levels * 72));
    const lightCanvas = document.createElement('canvas'); lightCanvas.width = windowCanvas.width; lightCanvas.height = windowCanvas.height;
    const ctx = windowCanvas.getContext('2d'), glow = lightCanvas.getContext('2d');
    const w = windowCanvas.width, h = windowCanvas.height, cw = w / columns, fh = h / levels;
    ctx.fillStyle = kind === 'office' ? ['#526a78', '#6c7d83', '#727778'][style % 3] : wallColors[style % 8]; ctx.fillRect(0, 0, w, h);
    const photo = textures.limestone?.image;
    if (kind !== 'office' && photo && photo.width && photo.height) { ctx.globalAlpha = .22; ctx.drawImage(photo, 0, 0, w, h); ctx.globalAlpha = 1; }
    glow.fillStyle = '#000'; glow.fillRect(0, 0, w, h);
    if (kind !== 'office' && style % 3 === 1) {
      for (let y = 0; y < h; y += 7) { ctx.fillStyle = 'rgba(45,33,28,.13)'; ctx.fillRect(0, y, w, 1); for (let x = (y % 14 ? 14 : 0); x < w; x += 28) ctx.fillRect(x, y, 1, 7); }
    }
    if (photographic) {
      // The source has seven literal floor rows and six bays; preserve their details.
      const sourceFloor = officePhoto.height / 7;
      for (let floor = 0; floor < levels; floor++) ctx.drawImage(officePhoto, 0, (floor % 7) * sourceFloor, officePhoto.width, sourceFloor, 0, floor * fh, w, fh + 1);
      const pixels = ctx.getImageData(0, 0, w, h).data;
      const illumination = glow.createImageData(w, h);
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
        const warmth = r > b * 1.12 && g > b * .97;
        const strength = warmth ? Math.max(0, Math.min(1, (r * .213 + g * .715 + b * .072 - 55) / 120)) : 0;
        illumination.data[i] = r * strength; illumination.data[i + 1] = g * strength; illumination.data[i + 2] = b * strength; illumination.data[i + 3] = 255;
      }
      glow.putImageData(illumination, 0, 0);
    } else for (let floor = 0; floor < levels; floor++) for (let column = 0; column < columns; column++) {
      const px = column * cw, py = floor * fh;
      const paddingX = kind === 'office' ? 2 : cw * .2, paddingY = kind === 'office' ? 5 : fh * .21;
      ctx.fillStyle = kind === 'office' ? '#71808a' : '#dedbd0'; ctx.fillRect(px + paddingX - 3, py + paddingY - 3, cw - paddingX * 2 + 6, fh - paddingY * 2 + 6);
      const gradient = ctx.createLinearGradient(px, py, px + cw, py + fh); gradient.addColorStop(0, '#203344'); gradient.addColorStop(.5, '#526775'); gradient.addColorStop(1, '#243442');
      ctx.fillStyle = gradient; ctx.fillRect(px + paddingX, py + paddingY, cw - paddingX * 2, fh - paddingY * 2);
      ctx.fillStyle = 'rgba(193,218,225,.16)'; ctx.fillRect(px + paddingX + 2, py + paddingY + 2, (cw - paddingX * 2) * .25, fh - paddingY * 2 - 4);
      if (random() > (kind === 'office' ? .46 : .6)) {
        glow.fillStyle = random() > .6 ? '#c9b799' : '#ecc992'; glow.fillRect(px + paddingX + 3, py + paddingY + 3, cw - paddingX * 2 - 6, fh - paddingY * 2 - 6);
        ctx.fillStyle = 'rgba(109,88,64,.28)'; ctx.fillRect(px + paddingX, py + paddingY, cw - paddingX * 2, fh - paddingY * 2);
      }
      if (kind !== 'office') { ctx.fillStyle = '#afb3ad'; ctx.fillRect(px + cw / 2 - 1, py + paddingY, 2, fh - paddingY * 2); }
      ctx.fillStyle = 'rgba(207,207,197,.35)'; ctx.fillRect(px, py + fh - 3, cw, 3);
    }
    const map = new THREE.CanvasTexture(windowCanvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
    const emissiveMap = new THREE.CanvasTexture(lightCanvas); emissiveMap.colorSpace = THREE.SRGBColorSpace;
    const result = new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: '#f0cd97', emissiveIntensity: kind === 'office' ? .95 : .7, roughness: kind === 'office' ? .27 : .84, metalness: kind === 'office' ? .46 : .03 });
    facadeCache.set(key, result); emissiveMaterials.push(result); return result;
  }

  function sign(parent, label, width, x, y, z, front = 1, color = '#dce5df') {
    const key = `${label}:${color}`;
    if (!signCache.has(key)) {
      const map = canvasTexture(512, 96, ctx => { ctx.fillStyle = '#26353b'; ctx.fillRect(0, 0, 512, 96); ctx.fillStyle = color; ctx.font = '500 43px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 256, 50, 480); });
      signCache.set(key, new THREE.MeshStandardMaterial({ map, roughness: .52, emissive: '#9aada9', emissiveMap: map, emissiveIntensity: .16 }));
    }
    const mesh = box(parent, width, .75, .1, x, y, z, signCache.get(key)); if (front < 0) mesh.rotation.y = Math.PI;
    return mesh;
  }
  function tree(x, z, height = 7, parent = group) {
    const trunkHeight = height * .47;
    cylinder(parent, .32 + height * .02, trunkHeight, x, .15 + trunkHeight / 2, z, material('#65574a'), true);
    add(parent, crownGeometry, leaf[0], x, height * .71, z, height * .32, height * .30, height * .30);
    add(parent, crownGeometry, leaf[1], x - height * .17, height * .61, z + height * .09, height * .22, height * .24, height * .23);
    add(parent, crownGeometry, leaf[2], x + height * .16, height * .68, z - height * .09, height * .22, height * .26, height * .22);
  }
  function bench(x, z, rotation = 0, parent = group) {
    const b = new THREE.Group(); b.position.set(x, .15, z); b.rotation.y = rotation; parent.add(b);
    box(b, 1.8, .12, .5, 0, .48, 0, wood);
    box(b, 1.8, .42, .10, 0, .88, -.23, wood);
    for (const side of [-1, 1]) { box(b, .08, .48, .5, side * .68, .24, 0, iron); box(b, .08, .38, .08, side * .68, .75, -.22, iron); }
  }
  function streetLamp(x, z, direction = 1) {
    cylinder(group, .16, 7.3, x, 3.8, z, iron);
    box(group, 1.9, .12, .13, x + direction * .85, 7.4, z, iron);
    box(group, .7, .15, .32, x + direction * 1.8, 7.35, z, iron);
    const emitter = box(group, .51, .025, .25, x + direction * 1.8, 7.27, z, lampMaterial); emitter.castShadow = false;
  }
  function flowerBed(x, z, w, d) {
    box(group, w, .22, d, x, .2, z, stone);
    box(group, w - .3, .05, d - .3, x, .34, z, material('#4f4a3d'));
    for (let i = 0; i < 8; i++) {
      const px = x + (random() - .5) * (w - .6), pz = z + (random() - .5) * (d - .6);
      add(group, crownGeometry, leaf[i % 3], px, .65, pz, .6, .32, .5);
      if (i % 2 === 0) add(group, crownGeometry, material(['#bc9e8d', '#ae9452', '#9b91b0'][i % 3]), px, .92, pz, .22, .14, .22);
    }
  }

  const worldBounds = { minX: -630, maxX: 630, minZ: -540, maxZ: 540, width: 1260, depth: 1080 };
  const xLines = Array.from({ length: 13 }, (_, i) => -540 + i * 90);
  const zLines = Array.from({ length: 11 }, (_, i) => -495 + i * 90);
  const roads = { xLines, zLines, halfWidth: 6, laneOffset: 3, sidewalkWidth: 2.8, bounds: { minX: -610, maxX: 610, minZ: -520, maxZ: 430 }, width: 1220, length: 950 };
  const waterAreas = [{ minX: -630, maxX: 630, minZ: 430, maxZ: 540, x: 0, z: 485, width: 1260, depth: 110, y: -.25 }];
  const bridgeAreas = [-180, 180].map(x => ({ minX: x - 7, maxX: x + 7, minZ: 395, maxZ: 540, x, z: 467.5, width: 14, depth: 145, height: 1.35, groundHeight: .15, rampStart: 395, rampEnd: 430 }));
  box(group, 1260, .18, 970, 0, -.09, -55, lawn);
  for (const x of xLines) {
    box(group, 12, .045, 950, x, .025, -45, asphaltV);
    for (const side of [-1, 1]) box(group, 2.8, .15, 950, x + side * 7.4, .075, -45, paving);
    for (let z = -510; z < 423; z += 18) if (zLines.every(line => Math.abs(line - z) > 9)) {
      box(group, .12, .012, 5.5, x, .055, z, yellow);
    }
  }
  for (const z of zLines) {
    box(group, 1220, .045, 12, 0, .027, z, asphaltH);
    for (const side of [-1, 1]) box(group, 1220, .15, 2.8, 0, .076, z + side * 7.4, paving);
    for (let x = -600; x < 602; x += 18) if (xLines.every(line => Math.abs(line - x) > 9)) box(group, 5.5, .012, .12, x, .057, z, yellow);
  }
  const crossingMap = canvasTexture(256, 256, ctx => { ctx.fillStyle = '#45494d'; ctx.fillRect(0, 0, 256, 256); ctx.fillStyle = '#d6d7cf'; for (let i = 0; i < 8; i++) ctx.fillRect(10 + i * 31, 12, 15, 232); });
  const crossingMaterial = new THREE.MeshStandardMaterial({ map: crossingMap, roughness: .94 });
  for (const x of xLines) for (const z of zLines) {
    // Crossroads remain flush; long sidewalks stop at the pedestrian crossing.
    box(group, 17.7, .18, 17.7, x, .065, z, asphaltPlain);
    if ((Math.abs(x) < 280 && Math.abs(z) < 230) || random() < .22) {
      for (const side of [-1, 1]) { box(group, 10.8, .025, 2.8, x, .169, z + side * 7.4, crossingMaterial); const cross = box(group, 10.8, .025, 2.8, x + side * 7.4, .169, z, crossingMaterial); cross.rotation.y = Math.PI / 2; }
    }
  }
  // A continuous waterfront walk is accessible from every north/south street.
  box(group, 1220, .15, 12, 0, .075, 424, paving);
  for (const x of [-180, 180]) {
    const rampLength = 35, rise = 1.2, angle = Math.atan2(rise, rampLength);
    const ramp = box(group, 14, .22, Math.hypot(rampLength, rise), x, .75 - .11 * Math.cos(angle), 412.5, asphaltPlain); ramp.rotation.x = -angle;
    box(group, 14, .55, 110, x, 1.35 - .275, 485, stone);
    box(group, 12, .045, 110, x, 1.35 - .023, 485, asphaltV);
    for (const side of [-1, 1]) {
      box(group, .1, .1, 110, x + side * 6.65, 2.35, 485, iron);
      for (let z = 432; z < 540; z += 6) box(group, .09, 1.04, .09, x + side * 6.65, 1.86, z, iron);
    }
    for (let z = 440; z < 540; z += 25) { cylinder(group, 2.5, 2.5, x - 4, -.05, z, stone); cylinder(group, 2.5, 2.5, x + 4, -.05, z, stone); }
  }
  box(group, 1260, .06, 110, 0, -.28, 485, waterMaterial);
  for (let x = -600; x < 610; x += 45) if (Math.abs(Math.abs(x) - 180) > 12) {
    box(group, 44.8, 1.1, .7, x + 22.5, -.4, 430, stone);
    if (Math.abs(x) < 300) bench(x + 12, 420, Math.PI);
  }

  function registerBuilding(type, x, z, width, depth, levels, style, front = 1, name) {
    const id = `${type}-${buildings.length + 1}`;
    const height = levels * 3.1;
    const buildingGroup = new THREE.Group(); buildingGroup.position.set(x, 0, z); buildingGroup.name = name || `${type} ${buildings.length + 1}`; group.add(buildingGroup);
    const door = new THREE.Vector3(x, .15, z + front * (depth / 2 + .65));
    const record = { id, type, name: buildingGroup.name, position: new THREE.Vector3(x, 0, z), width, depth, height, door, seed: seed >>> 0, levels, front, doorFacing: new THREE.Vector3(0, 0, front), entryLook: new THREE.Vector3(0, 0, -front), style, group: buildingGroup };
    buildings.push(record); doors.push({ id, buildingId: id, type, position: door.clone(), entryLook: record.entryLook.clone(), face: front === 1 ? '+Z' : '-Z', building: record });
    box(buildingGroup, width + .3, .22, depth + .3, 0, .11, 0, stone);
    const mass = box(buildingGroup, width, height, depth, 0, height / 2 + .15, 0, facade(style, levels, type === 'office' ? 6 : width > 20 ? 5 : 3, type === 'office' ? 'office' : 'home'), true);
    mass.userData.buildingMass = true;
    return { record, parent: buildingGroup };
  }
  function finishBuilding(record) {
    record.group.traverse(node => { if (node.isMesh) node.userData.landmark = record.id; });
  }
  function doorAndWalk(record, sidewalkZ, shop = false) {
    const p = record.group, front = record.front, z = front * (record.depth / 2 + .07);
    const doorWidth = shop ? 1.65 : 1.15, height = shop ? 2.6 : 2.2;
    box(p, doorWidth + .3, height + .25, .12, 0, .15 + height / 2, z, material('#d2d0c6'));
    box(p, doorWidth, height, .15, 0, .15 + height / 2, z + front * .07, shop ? glass : material(doorColors[record.style % 8], .65));
    if (!shop) box(p, doorWidth * .5, .8, .04, 0, 1.6, z + front * .16, warmGlass);
    box(p, .035, .22, .05, doorWidth * .32, 1.2, z + front * .2, iron);
    box(p, 2.8, .09, 1.6, 0, .18, z + front * .85, paving);
    if (Number.isFinite(sidewalkZ)) {
      const fromZ = record.door.z + front * .8;
      const length = Math.abs(sidewalkZ - fromZ);
      if (length > .2) box(group, shop ? 3 : 1.65, .09, length, record.position.x, .15, (sidewalkZ + fromZ) / 2, paving);
    }
  }
  function physicalWindow(parent, x, y, z, style, front, width = 1.25, height = 1.55, mullion = false) {
    box(parent, width + .22, height + .2, .09, x, y, z, wallPlain[(style + 4) % 8]);
    box(parent, width, height, .045, x, y, z + front * .072, random() > .58 ? warmGlass : glass);
    if (mullion) box(parent, .05, height, .06, x, y, z + front * .103, wallPlain[(style + 4) % 8]);
  }
  function roofProfile(building, kind, baseY, height, halfWidth, halfDepth) {
    const profile = { kind, baseY, height, halfWidth, halfDepth, centerX: building.position.x, centerZ: building.position.z };
    profile.heightAt = point => {
      const nx = Math.abs(point.x - profile.centerX) / halfWidth, nz = Math.abs(point.z - profile.centerZ) / halfDepth;
      if (nx > 1 || nz > 1) return -Infinity;
      return baseY + height * (1 - (kind === 'hip' ? Math.max(nx, nz) : kind === 'gable' ? nx : 0));
    };
    building.roofProfile = profile;
    return profile;
  }
  function exactBoxRoofSampler(profile, roofMeshes) {
    // Tile thickness and their small ridge overlap are included in the support height.
    const unitBounds = new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5));
    const worldRay = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
    const localRay = new THREE.Ray(), hit = new THREE.Vector3();
    const transforms = roofMeshes.map(mesh => {
      mesh.updateWorldMatrix(true, false);
      return { matrix: mesh.matrixWorld.clone(), inverse: mesh.matrixWorld.clone().invert() };
    });
    profile.heightAt = point => {
      if (Math.abs(point.x - profile.centerX) > profile.halfWidth || Math.abs(point.z - profile.centerZ) > profile.halfDepth) return -Infinity;
      worldRay.origin.set(point.x, profile.baseY + profile.height + 5, point.z);
      let support = -Infinity;
      for (const { matrix, inverse } of transforms) {
        localRay.copy(worldRay).applyMatrix4(inverse);
        if (localRay.intersectBox(unitBounds, hit)) support = Math.max(support, hit.applyMatrix4(matrix).y);
      }
      return support;
    };
  }

  function house(x, z, style, front, sidewalkZ, townhouse = false) {
    const levels = townhouse || style % 4 !== 0 ? 2 : 1;
    const width = townhouse ? 8.6 : 10.5 + (style % 3) * 1.3, depth = townhouse ? 15.5 : 13 + (style % 3) * 1.5;
    const { record: b, parent: p } = registerBuilding(townhouse ? 'townhouse' : 'house', x, z, width, depth, levels, style, front);
    const h = b.height + .15, roofRise = townhouse ? 2.1 : 2.4 + (style % 2) * .45;
    if (style === 6) {
      const support = box(p, width + .45, .22, depth + .45, 0, h + .06, 0, roofs[style], true); support.userData.roofSupport = true;
      roofProfile(b, 'flat', h + .17, 0, (width + .45) / 2, (depth + .45) / 2);
      for (const side of [-1, 1]) { box(p, width, .4, .14, 0, h + .35, side * depth / 2, wallPlain[style]); box(p, .14, .4, depth, side * width / 2, h + .35, 0, wallPlain[style]); }
      box(p, width * .45, .1, depth * .4, 0, h + .2, 0, lawn);
    } else if (style % 3 === 0) {
      add(p, hipGeometry, roofs[style], 0, h + roofRise / 2, 0, width + 1, roofRise, depth + 1);
      roofProfile(b, 'hip', h, roofRise, (width + 1) / 2, (depth + 1) / 2);
    } else {
      add(p, gableGeometry, wallPlain[style], 0, h, 0, width, roofRise, depth);
      const slope = Math.atan2(roofRise, width / 2), length = Math.hypot(width / 2, roofRise) + .6;
      const tiles = [];
      for (const side of [-1, 1]) { const roof = box(p, length, .19, depth + 1, side * width / 4, h + roofRise / 2, 0, roofs[style]); roof.rotation.z = -side * slope; tiles.push(roof); }
      const eaves = .3 * Math.cos(slope) + .095 * Math.sin(slope);
      const profile = roofProfile(b, 'gable', h, roofRise, width / 2 + eaves, (depth + 1) / 2);
      profile.pitch = slope; profile.wallHalfWidth = width / 2; profile.slabThickness = .19;
      exactBoxRoofSampler(profile, tiles);
    }
    box(p, .6, 1.65, .85, width * .28, h + 1.2, -depth * .22, material('#857162'));
    box(p, .8, .14, 1.02, width * .28, h + 2.1, -depth * .22, stone);
    for (let floor = 0; floor < levels; floor++) {
      const y = 1.85 + floor * 3.1;
      for (const side of [-1, 1]) physicalWindow(p, side * width * .28, y, front * (depth / 2 + .02), style, front, 1.3, 1.55, floor === 0);
    }
    if (levels === 2) box(p, width + .12, .1, depth + .12, 0, 3.25, 0, wallPlain[(style + 4) % 8]);
    doorAndWalk(b, sidewalkZ);
    if (style % 2 === 1) {
      const porchZ = front * (depth / 2 + 1.2);
      box(p, 4.4, .16, 2.7, 0, 2.8, porchZ, roofs[style]);
      for (const side of [-1, 1]) box(p, .14, 2.45, .14, side * 1.9, 1.43, porchZ + front * .9, wallPlain[4]);
    } else if (levels > 1) {
      const balconyZ = front * (depth / 2 + .85);
      box(p, 3.8, .16, 1.6, 0, 3.28, balconyZ, stone);
      box(p, 3.8, .07, .07, 0, 4.24, balconyZ + front * .68, iron);
      for (const side of [-1, 1]) box(p, .07, .95, .07, side * 1.78, 3.76, balconyZ + front * .68, iron);
    }
    const lawnWidth = townhouse ? 14 : 27;
    box(group, lawnWidth, .025, 31, x, .045, z, lawn);
    box(group, 3.15, .035, Math.abs(sidewalkZ - z), x + width / 2 + 2.1, .06, (z + sidewalkZ) / 2, asphaltPlain);
    if (!townhouse && random() > .6) tree(x - width / 2 - 3.7, z - front * 4, 5.2 + random() * 2.5);
    finishBuilding(b); return b;
  }

  function urbanBuilding(type, x, z, width, depth, levels, style, front, sidewalkZ, name) {
    const { record: b, parent: p } = registerBuilding(type, x, z, width, depth, levels, style, front, name);
    const h = b.height + .15;
    const roofSupport = box(p, width + .8, .32, depth + .8, 0, h + .09, 0, wallPlain[(style + 4) % 8], true); roofSupport.userData.roofSupport = true;
    const profile = roofProfile(b, 'flat', h + .25, 0, (width + .8) / 2, (depth + .8) / 2);
    for (const side of [-1, 1]) {
      box(p, width + .15, .5, .15, 0, h + .5, side * depth / 2, stone);
      box(p, .15, .5, depth, side * width / 2, h + .5, 0, stone);
    }
    box(p, 2.6, .9, 2.2, width * .22, h + .62, -depth * .25, material('#828a8b'));
    box(p, 1.7, .6, 1.8, -width * .28, h + .45, depth * .2, material('#8e9899'));
    doorAndWalk(b, sidewalkZ, true);
    const frontZ = front * (depth / 2 + .17);
    for (const side of [-1, 1]) physicalWindow(p, side * width * .28, 1.65, frontZ, style, front, width * .31, 2.5);
    if (type === 'office') {
      for (const side of [-1, 1]) box(p, .16, h - .15, .16, side * width / 2, h / 2, front * (depth / 2 + .07), material('#9daaad', .35, .5));
      if (levels > 16) {
        const crown = box(p, width * .56, 3.1, depth * .6, 0, h + 1.9, 0, facade(style, 1, 4, 'office'), true); crown.userData.roofSupport = true;
        profile.tiers = [{ kind: 'flat', baseY: h + 3.45, height: 0, halfWidth: width * .28, halfDepth: depth * .3, centerX: x, centerZ: z }];
        const lowerHeight = profile.heightAt;
        profile.heightAt = point => Math.abs(point.x - x) <= width * .28 && Math.abs(point.z - z) <= depth * .3 ? h + 3.45 : lowerHeight(point);
        b.height += 3.1;
      }
      box(p, width * .7, .24, 3.5, 0, 3.6, front * (depth / 2 + 1.7), iron);
    } else if (type === 'apartment') {
      for (let floor = 1; floor < Math.min(levels, 5); floor++) for (const side of [-1, 1]) {
        const balconyZ = front * (depth / 2 + .72);
        box(p, 4.5, .14, 1.45, side * width * .27, floor * 3.1 + .26, balconyZ, stone);
        box(p, 4.5, .8, .055, side * width * .27, floor * 3.1 + .75, balconyZ + front * .65, iron);
      }
    } else {
      const labels = { hospital: 'WESTHAVEN MEDICAL', gym: 'ATHLETIC CLUB', library: 'PUBLIC LIBRARY', school: 'WESTHAVEN SCHOOL', restaurant: 'NORTH & OAK', cafe: 'COMMON GROUND', store: 'MARKET HALL' };
      sign(p, name || labels[type] || type.toUpperCase(), Math.min(width * .72, 12), 0, 3.25, front * (depth / 2 + .3), front, type === 'hospital' ? '#c4e2df' : '#e3d6bd');
      if (['restaurant', 'cafe', 'store'].includes(type)) {
        const canopy = box(p, width * .83, .14, 2.7, 0, 3.05, front * (depth / 2 + 1.25), material(['#526b5f', '#8a6755', '#636f80'][style % 3])); canopy.rotation.x = front * .09;
      }
    }
    if (type === 'hospital') {
      box(p, 1.15, 3.1, .18, width * .37, h - 2.1, frontZ + front * .2, material('#ca7468'));
      box(p, 3.1, 1.15, .19, width * .37, h - 2.1, frontZ + front * .22, material('#ca7468'));
    }
    finishBuilding(b); return b;
  }

  function park(x, z, index) {
    box(group, 70, .12, 70, x, .06, z, lawn);
    box(group, 70, .12, 4.4, x, .09, z, paving); box(group, 4.4, .12, 70, x, .091, z, paving);
    cylinder(group, 10.7, .8, x, .49, z, stone);
    cylinder(group, 9.8, .06, x, .91, z, waterMaterial);
    cylinder(group, 1.2, 1.8, x, 1.8, z, stone);
    cylinder(group, 3.1, .2, x, 2.72, z, stone);
    cylinder(group, .12, 1.2, x, 3.42, z, material('#b9d2d2', .18, .25));
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      tree(x + a * 23, z + b * 23, 7.5 + random() * 3);
      tree(x + a * 11, z + b * 26, 6 + random() * 2);
      flowerBed(x + a * 17, z + b * 12, 8, 3);
      bench(x + a * 9, z + b * 5, b < 0 ? 0 : Math.PI);
    }
    if (index % 2) {
      // A small basketball court uses physically sized markings and simple hoops.
      box(group, 15, .025, 28, x + 20, .155, z, material('#657872'));
      for (const side of [-1, 1]) {
        box(group, .12, .018, 28, x + 20 + side * 7.3, .18, z, white);
        box(group, 14.7, .018, .12, x + 20, .18, z + side * 13.6, white);
        cylinder(group, .13, 3.5, x + 20, 1.9, z + side * 13.4, iron, true);
        box(group, 1.8, 1.1, .08, x + 20, 3.25, z + side * 12.5, white);
      }
    }
  }
  function marketStall(x, z, style, front) {
    const canopy = material(['#916f5c', '#758879', '#737f90', '#ad9971'][style % 4]);
    box(group, 3.4, .14, 2.6, x, 2.45, z, canopy);
    for (const side of [-1, 1]) cylinder(group, .065, 2.3, x + side * 1.5, 1.25, z - front * 1, iron);
    box(group, 3.1, .8, 1.1, x, .55, z, wood, true);
    for (let i = 0; i < 3; i++) {
      box(group, .78, .2, .7, x - 1 + i, 1.08, z, material('#94775d'));
      add(group, crownGeometry, material(['#ba7457', '#86915b', '#ac9a56'][i]), x - 1 + i, 1.32, z, .3, .14, .24);
    }
  }

  const districts = [
    { id: 'downtown', name: 'Downtown', position: new THREE.Vector3(0, 0, -45), bounds: { minX: -180, maxX: 180, minZ: -225, maxZ: 135 } },
    { id: 'civic', name: 'Civic Quarter', position: new THREE.Vector3(-45, 0, -180) },
    { id: 'market', name: 'Oak Market', position: new THREE.Vector3(45, 0, 180) },
    { id: 'gardens', name: 'West Gardens', position: new THREE.Vector3(-315, 0, -90) },
    { id: 'residential', name: 'The Neighborhoods', position: new THREE.Vector3(-405, 0, -360) },
    { id: 'waterfront', name: 'Harbour District', position: new THREE.Vector3(45, 0, 360) },
  ];
  for (let row = 0; row < 10; row++) for (let column = 0; column < 12; column++) {
    const x = -495 + column * 90, z = -450 + row * 90;
    const northWalk = z - 36.2, southWalk = z + 36.2;
    const style = (column * 3 + row * 5) % 8;
    if ((column === 2 && row === 4) || (column === 8 && row === 5) || (column === 5 && row === 6) || (column === 1 && row === 8)) {
      park(x, z, row); continue;
    }
    if (column === 5 && row === 3) {
      urbanBuilding('hospital', x, z - 4, 49, 40, 5, 4, 1, southWalk);
      box(group, 54, .05, 15, x, .05, z + 24, asphaltPlain);
      for (let i = 0; i < 9; i++) box(group, .11, .015, 5.8, x - 24 + i * 6, .09, z + 26, white);
      continue;
    }
    if (column === 6 && row === 3) { urbanBuilding('gym', x, z, 44, 43, 2, 2, 1, southWalk); tree(x - 28, z + 22, 8); continue; }
    if (column === 4 && row === 4) { urbanBuilding('library', x, z, 42, 39, 3, 4, 1, southWalk); flowerBed(x, z + 28, 18, 3); continue; }
    if (column === 7 && row === 5) { urbanBuilding('school', x, z, 45, 38, 3, 3, -1, northWalk); tree(x - 29, z + 20, 8); continue; }
    if (row === 7 && column >= 3 && column <= 8) {
      for (const front of [-1, 1]) for (const side of [-1, 1]) {
        const b = urbanBuilding(side === 1 ? 'restaurant' : column % 2 ? 'cafe' : 'store', x + side * 18, z + front * 15, 24, 23, 2 + column % 2, style, front, front > 0 ? southWalk : northWalk);
        if (column % 2 === 0) marketStall(b.position.x + 7, b.door.z + front * 4.2, style, front);
      }
      tree(x, z, 8); continue;
    }
    if (row === 9 && column >= 2 && column <= 9) {
      urbanBuilding('apartment', x - 17, z - 3, 26, 34, 5, style, 1, southWalk);
      urbanBuilding(column % 2 ? 'cafe' : 'restaurant', x + 22, z + 9, 21, 24, 2, (style + 2) % 8, 1, southWalk);
      tree(x + 20, z - 22, 8.5); continue;
    }
    if (Math.abs(x) <= 135 && z >= -270 && z <= 90) {
      const levels = [8, 12, 17, 23, 29][(column + row) % 5];
      urbanBuilding('office', x - 17, z - 3, 27, 34, levels, style % 3, -1, northWalk);
      urbanBuilding(column % 2 ? 'apartment' : 'office', x + 20, z + 7, 25, 28, Math.max(6, levels - 5), (style + 1) % 3, 1, southWalk);
      tree(x + 22, z - 23, 8); bench(x + 20, z + 29, Math.PI); continue;
    }
    const townhouse = Math.abs(x) < 300 && row > 1 && row < 8;
    for (const front of [-1, 1]) for (const side of [-1, 1]) house(x + side * 18, z + front * 18, (style + (side > 0 ? 2 : 0) + (front > 0 ? 1 : 0)) % 8, front, front > 0 ? southWalk : northWalk, townhouse);
  }
  // Repeated street furniture shares geometry and materials across the entire world.
  for (let i = 0; i < xLines.length; i++) for (let z = -472; z < 407; z += 90) {
    streetLamp(xLines[i] + 7.8, z + 9, -1);
    if (i % 2 === 0 && zLines.every(line => Math.abs(line - z) > 12)) tree(xLines[i] - 10.5, z, 6.5 + random() * 2);
  }
  for (const z of [-405, -135, 135, 405]) for (let x = -500; x < 510; x += 90) streetLamp(x + 22, z - 7.8, 1);
  box(group, 3, .08, 7, -21, .06, 27, asphaltPlain);

  // Metadata is retained before the root combines static meshes into spatial batches.
  group.updateMatrixWorld(true);
  const worldCenter = new THREE.Vector3(), worldScale = new THREE.Vector3(), worldQuaternion = new THREE.Quaternion();
  group.traverse(mesh => {
    if (!mesh.isMesh || !mesh.userData.collision) return;
    mesh.matrixWorld.decompose(worldCenter, worldQuaternion, worldScale);
    collidersData.push({ object: mesh, mesh, index: 0, center: worldCenter.clone(), scale: worldScale.clone(), buildingId: mesh.userData.landmark || null, type: mesh.geometry.type === 'CylinderGeometry' ? 'tree' : mesh.userData.landmark ? 'building' : 'furniture' });
  });
  return {
    group, collidersData, buildings, doors, roads, districts,
    spawn: new THREE.Vector3(-23.5, .15, 23.6), waterAreas, bridgeAreas, worldBounds,
    emissiveMaterials,
    materials: { asphalt: asphaltPlain, asphaltV, asphaltH, paving, lawn, water: waterMaterial, facades: [...facadeCache.values()], glass, warmGlass },
  };
}
