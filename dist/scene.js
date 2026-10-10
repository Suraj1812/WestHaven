import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { createHero, createNPC } from './characters.js';
import { createDestructionSystem } from './destruction.js';
import { constrainGroundMove, getSurfaceHeight, blockedByBuilding } from './physics.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { bindCanvasSelection } from './pointer.js';
import { createTree, createCar, createBoat, createStreetLamp, createBench, createPlanter } from './details.js';

const WORLD_SCALE=3;
const $ = id => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const smallScreen = () => window.innerWidth < 700;
const canvas = $('city-canvas');
const state = { night: 0, targetNight: 0, auto: false, sound: false, visible: true, selected: null };
const landmarks = {
  meridian: { name: 'The Meridian', type: 'DOWNTOWN', description: 'Glass, light, and a view above it all.', position: [4.7, 0, -3.1] },
  gardens: { name: 'Willow Gardens', type: 'THE GARDENS', description: 'A quiet green corner, beside the water.', position: [-15, 0, -1.4] },
  marina: { name: 'Harbour House', type: 'THE WATERFRONT', description: 'Slow boats. Warm light. A little room to breathe.', position: [14.5, 0, 6.05] },
  oldtown: { name: 'The Old Quarter', type: 'OLD TOWN', description: 'Sun-warmed stone and streets with a slower rhythm.', position: [-13, 0, -11] },
  terrace: { name: 'The Terraces', type: 'RIVERSIDE', description: 'Rooftop gardens with the city at your feet.', position: [7, 0, 0] },
};
let renderer, scene, camera, controls, sun, fill, ground, water, selectionRing, city, clock, animation;
let transition = null, lastFrame = 0, frameEMA = 16, slowFrames = 0, qualityReduced = false;
const vehicles = [], boats = [], birds = [], emissiveMaterials = [], staticMeshes = [], nightLights = [];
let streetGlows;
let randomSeed = 93211;
const random = () => { randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0; return randomSeed / 4294967296; };
const materialCache = new Map();
const textureLoader=new THREE.TextureLoader();
const asphaltTexture=textureLoader.load('./assets/asphalt-texture.jpg');asphaltTexture.colorSpace=THREE.SRGBColorSpace;asphaltTexture.wrapS=asphaltTexture.wrapT=THREE.RepeatWrapping;asphaltTexture.repeat.set(2,18);asphaltTexture.anisotropy=4;
const limestoneTexture=textureLoader.load('./assets/limestone-texture.jpg');limestoneTexture.colorSpace=THREE.SRGBColorSpace;limestoneTexture.wrapS=limestoneTexture.wrapT=THREE.RepeatWrapping;limestoneTexture.repeat.set(6,6);limestoneTexture.anisotropy=4;

const mat = (color, roughness = .8, metalness = 0) => {
  const key = `${color}-${roughness}-${metalness}`;
  if (!materialCache.has(key)) {
    const asphalt=color==='#7a8580';const stone=['#c8c9b7','#dad9c8','#d0d3c3','#d0d0bf','#e4dfce','#e0dfd0','#e1dfcd','#ddd5c0','#c3c3ac','#b7bcad','#d3d2bb','#c5c4b5'].includes(color);
    const m=new THREE.MeshPhysicalMaterial({color:asphalt?'#828b92':color,roughness:asphalt?.28:roughness,metalness:asphalt?.10:metalness,clearcoat:asphalt?.75:0,clearcoatRoughness:.2,map:asphalt?asphaltTexture:stone?limestoneTexture:null,bumpMap:asphalt?asphaltTexture:stone?limestoneTexture:null,bumpScale:asphalt?.045:stone?.025:0});materialCache.set(key,m);
  }
  return materialCache.get(key);
};
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 20);
function box(parent, w, h, d, x, y, z, material, landmark) {
  const mesh = new THREE.Mesh(unitBox, material);
  mesh.scale.set(w, h, d); mesh.position.set(x, y, z);
  mesh.castShadow = h > .15; mesh.receiveShadow = true;
  if (landmark) mesh.userData.landmark = landmark;
  parent.add(mesh); return mesh;
}
function cylinder(parent, r, h, x, y, z, material) {
  const mesh = new THREE.Mesh(unitCylinder, material); mesh.scale.set(r, h, r);
  mesh.position.set(x,y,z); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh); return mesh;
}
function prop(fn, x, z, options, rotation = 0, parent = city) {
  const object = fn(options); object.position.set(x, .14, z); object.rotation.y = rotation; parent.add(object); return object;
}

function facade(kind = 'glass', floors = 16, columns = 8) {
  const textureCanvas = document.createElement('canvas'); textureCanvas.width = 256; textureCanvas.height = 512;
  const ctx = textureCanvas.getContext('2d');
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = 256; glowCanvas.height = 512;
  const glow = glowCanvas.getContext('2d'); glow.fillStyle = '#000'; glow.fillRect(0,0,256,512);
  const glass = kind === 'glass';
  ctx.fillStyle = glass ? '#759594' : kind === 'brick' ? '#ba8d77' : '#d8d3bd'; ctx.fillRect(0,0,256,512);
  for (let row = 0; row < floors; row++) {
    for (let col = 0; col < columns; col++) {
      const cw = 256 / columns, rh = 512 / floors;
      const padX = glass ? 1.8 : cw * .24, padY = glass ? 2 : rh * .22;
      const lit = random() > .38;
      ctx.fillStyle = glass ? (random() > .65 ? '#9aafaa' : '#6c898b') : '#526d70';
      ctx.fillRect(col*cw+padX,row*rh+padY,cw-padX*2,rh-padY*2);
      if(lit) { glow.fillStyle = random() > .6 ? '#e4b66d' : '#ffd6a0'; glow.fillRect(col*cw+padX+1,row*rh+padY+1,cw-padX*2-2,rh-padY*2-2); }
      if(glass){ctx.fillStyle = 'rgba(223,233,224,.12)';ctx.fillRect(col*cw+padX,row*rh+padY,cw*.24,rh-padY*2);}
    }
    if (!glass) { ctx.fillStyle = kind === 'brick' ? '#d0ad99' : '#e5e1d0'; ctx.fillRect(0,row*512/floors,256,2); }
  }
  const map = new THREE.CanvasTexture(textureCanvas); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  const emissiveMap = new THREE.CanvasTexture(glowCanvas); emissiveMap.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshStandardMaterial({map, roughness: glass ? .26 : .85, metalness: glass ? .42 : .02, emissiveMap, emissive: '#ffc784', emissiveIntensity: 0});
  if(!glass){material.bumpMap=limestoneTexture;material.bumpScale=.027;}emissiveMaterials.push(material); return material;
}
const glassFacades = [], stoneFacades = [], brickFacades = [];
function roofDetails(parent, x,z,w,d,y, green=false) {
  const roof = mat('#d0d0bf');
  box(parent,w+.06,.16,d+.06,x,y,z,roof);
  for (const side of [-1,1]) {
    box(parent,w,.24,.10,x,y+.18,z+side*(d/2-.05),mat('#e4dfce'));
    box(parent,.10,.24,d,x+side*(w/2-.05),y+.18,z,mat('#e4dfce'));
  }
  box(parent,w*.25,.36,d*.2,x+w*.20,y+.26,z-d*.12,mat('#a6ada6'));
  box(parent,w*.18,.13,d*.16,x-w*.24,y+.14,z+d*.17,mat('#b0b8b1'));
  if(green){box(parent,w*.50,.09,d*.36,x-.10,y+.13,z,mat('#7c9270'));for(let i=0;i<3;i++){const tree=createTree({size:.42});tree.position.set(x-w*.2+i*.6,y+.2,z+.2);parent.add(tree);}}
}
function building({x,z,w,d,h,kind='glass',landmark='meridian',terrace=false}) {
  const id = kind === 'glass' ? Math.floor(random()*glassFacades.length) : kind === 'brick' ? Math.floor(random()*brickFacades.length) : Math.floor(random()*stoneFacades.length);
  const facadeMaterial=(kind==='glass'?glassFacades:kind==='brick'?brickFacades:stoneFacades)[id];
  const roof = mat(kind==='brick'?'#c6b29c':'#e0dfd0');
  const facadeSet = [facadeMaterial,facadeMaterial,roof,roof,facadeMaterial,facadeMaterial];
  const group = new THREE.Group(); city.add(group);
  box(group,w+.30,.32,d+.30,x,.28,z,mat('#c5c4b5'),landmark);
  box(group,w,h,d,x,h/2+.44,z,facadeSet,landmark);
  box(group,w+.10,.22,d+.10,x,.75,z,mat('#e1dfcd'),landmark);
  if (kind!=='glass') {
    for(let floor=1;floor<h/1.3;floor++){const yy=.42+floor*1.3;box(group,w+.1,.08,d+.1,x,yy,z,roof,landmark);}
    box(group,w+.22,.16,d+.22,x,h+.30,z,roof,landmark);
    // Articulated shopfront awnings at street level.
    const awning=box(group,w*.82,.12,.55,x,1.13,z+d/2+.14,mat(kind==='brick'?'#54756a':'#9d775e'),landmark);awning.rotation.x=-.10;
    for(const side of [-1,1])box(group,.11,.8,.11,x+side*w*.32,.7,z+d/2+.37,mat('#dcd6c3'));
  } else {
    for(const side of [-1,1]) {
      box(group,.10,h,.10,x+side*w/2,h/2+.45,z+d/2,mat('#c6d0c5'),landmark);
      box(group,.10,h,.10,x+side*w/2,h/2+.45,z-d/2,mat('#c6d0c5'),landmark);
    }
    for(let i=1;i<h/3;i++)box(group,w+.10,.12,d+.10,x,.44+i*3,z,mat('#bac6bb'),landmark);
  }
  roofDetails(group,x,z,w,d,h+.48,terrace);
  group.traverse(node=>{if(node.isMesh&&!node.userData.landmark)node.userData.landmark=landmark;});
  return group;
}

function environment() {
  const c=document.createElement('canvas');c.width=512;c.height=256;const cx=c.getContext('2d');
  const gradient=cx.createLinearGradient(0,0,0,256);gradient.addColorStop(0,'#edf3e9');gradient.addColorStop(.48,'#eef0d8');gradient.addColorStop(.52,'#d0d9c7');gradient.addColorStop(1,'#87988e');cx.fillStyle=gradient;cx.fillRect(0,0,512,256);
  const sunGradient=cx.createRadialGradient(100,72,2,100,72,65);sunGradient.addColorStop(0,'#fff7de');sunGradient.addColorStop(1,'rgba(255,243,217,0)');cx.fillStyle=sunGradient;cx.fillRect(0,0,512,256);
  const texture=new THREE.CanvasTexture(c);texture.mapping=THREE.EquirectangularReflectionMapping;texture.colorSpace=THREE.SRGBColorSpace;
  const pmrem=new THREE.PMREMGenerator(renderer);const env=pmrem.fromEquirectangular(texture);scene.environment=env.texture;texture.dispose();pmrem.dispose();
}

function buildCity() {
  city = new THREE.Group();scene.add(city);
  const stone=mat('#c8c9b7'), paving=mat('#dad9c8'), asphalt=mat('#7a8580'), curb=mat('#d0d3c3'), white=mat('#e5e7d8'), grass=mat('#9aab7e');
  // A solid architectural plinth makes this little world feel collectible.
  box(city,42,1.2,36,0,-.86,0,mat('#b7bcad'));
  box(city,42.15,.20,36.15,0,-.20,0,stone);
  box(city,41,.23,25.4,0,-.035,-4.9,paving);
  box(city,42,.19,.45,0,.03,-17.75,curb);
  box(city,.45,.19,36,-20.75,.03,0,curb);box(city,.45,.19,36,20.75,.03,0,curb);
  for(let i=0;i<4;i++){glassFacades.push(facade('glass',16+i*3,7+i));stoneFacades.push(facade('stone',5+i,5));brickFacades.push(facade('brick',4+i,6));}
  // Orthogonal streets with inset sidewalks, lane marks and crossings.
  for(const x of [-10,0,10]) {
    box(city,2.1,.06,25,x,.11,-4.9,asphalt);
    box(city,.18,.13,25,x-1.13,.15,-4.9,curb);box(city,.18,.13,25,x+1.13,.15,-4.9,curb);
    for(let z=-16;z<7;z+=2)box(city,.05,.012,.8,x,.15,z,white);
  }
  for(const z of [-7,3]) {
    box(city,40.6,.07,2.1,0,.12,z,asphalt);
    box(city,40.6,.11,.18,0,.15,z-1.14,curb);box(city,40.6,.11,.18,0,.15,z+1.14,curb);
    for(let x=-19;x<20;x+=2)if(Math.abs(x%10)>1)box(city,.8,.014,.05,x,.165,z,white);
    for(const x of [-10,0,10])for(let i=0;i<6;i++){
      box(city,.19,.018,1.6,x-1.72+i*.26,.17,z,white);
      box(city,1.6,.018,.19,x,.17,z-1.72+i*.26,white);
    }
  }
  // Low-rise old town, deliberately varied rooflines and warm masonry.
  const old = [[-17,-13,2.6,3.1,4.2],[-13.9,-13,2.6,3.1,5.2],[-17,-9.9,2.6,2.6,3.6],[-13.8,-9.7,2.5,2.7,4.6]];
  old.forEach((b,i)=>building({x:b[0],z:b[1],w:b[2],d:b[3],h:b[4],kind:i%2?'stone':'brick',landmark:'oldtown'}));
  building({x:-5.6,z:-12,w:4.5,d:5.4,h:10.3,kind:'glass'});
  building({x:4.6,z:-12,w:5.2,d:4.8,h:13.4,kind:'glass'});
  // The Meridian: tiered tower, crown, fins and a slender spire.
  building({x:4.7,z:-3.1,w:5.5,d:5.1,h:2.1,kind:'stone'});
  building({x:4.7,z:-3.1,w:3.8,d:3.6,h:17,kind:'glass'});
  box(city,3.4,1.0,3.2,4.7,18,-3.1,mat('#b4c4ba'), 'meridian');
  box(city,2.9,.28,2.7,4.7,18.6,-3.1,mat('#dfdfcb'),'meridian');
  cylinder(city,.045,3,4.7,20.1,-3.1,mat('#c2c8bc'));
  for(let i=0;i<5;i++)box(city,.065,18.1,.09,3.1+i*.8,9.4,-1.27,mat('#b9c9bd'),'meridian');
  building({x:14.3,z:-12.8,w:4.3,d:4.3,h:8.6,kind:'glass'});
  building({x:16.8,z:-8.8,w:3.0,d:2.4,h:5.5,kind:'stone',landmark:'terrace',terrace:true});
  building({x:12.9,z:-2.1,w:3.1,d:4.6,h:6.1,kind:'stone',landmark:'terrace',terrace:true});
  building({x:16.9,z:-2.1,w:2.8,d:4.6,h:7.8,kind:'brick',landmark:'terrace',terrace:true});
  building({x:-5.2,z:-2.0,w:4.5,d:5.7,h:6.2,kind:'stone',landmark:'terrace',terrace:true});
  // Waterfront gallery and stacked balcony apartments.
  building({x:14.5,z:6.05,w:7.2,d:2.8,h:2.8,kind:'stone',landmark:'marina',terrace:true});
  for(let i=0;i<5;i++){box(city,1.0,.12,.8,11.4+i*1.55,1.9,7.75,mat('#eae3cf'),'marina');box(city,.95,.43,.04,11.4+i*1.55,2.13,8.14,mat('#adbbad'),'marina');}
  // Waterfront promenade, dark iron rails and public benches.
  box(city,40.4,.08,1.85,0,.2,7.30,mat('#ddd5c0'));
  box(city,40.4,.09,.20,0,.25,8.20,mat('#bac1b1'));
  for(let x=-19.5;x<20;x+=1.2){box(city,.055,.60,.055,x,.56,8.28,mat('#74887b'));}
  box(city,40,.045,.045,0,.85,8.28,mat('#74887b'));
  for(let x=-18;x<20;x+=4) { prop(createBench,x,7.55,null,Math.PI); prop(createStreetLamp,x+.7,6.65); }
  // A garden block with layered planting, intersecting gravel paths and a fountain.
  box(city,7.3,.10,7.4,-15,.22,-1.4,grass,'gardens');
  box(city,7.3,.035,.6,-15,.29,-1.5,mat('#e2dbc4'));
  box(city,.6,.035,7.4,-15,.29,-1.4,mat('#e2dbc4'));
  const fountain=cylinder(city,1.18,.20,-15,.37,-1.4,mat('#d3d2bb'));fountain.userData.landmark='gardens';
  cylinder(city,.96,.05,-15,.50,-1.4,mat('#74a7a1',.22,.3));
  cylinder(city,.24,.75,-15,.78,-1.4,mat('#b2c0ae'));cylinder(city,.49,.08,-15,1.20,-1.4,mat('#d7decd'));
  for(const p of [[-17.5,-3.8],[-12.7,-3.8],[-17.5,.9],[-12.7,.9]]){prop(createTree,p[0],p[1],{size:1.3});prop(createBench,p[0]+.2,p[1]+1.1);}
  for(let i=0;i<18;i++){const x=-18.2+random()*6.4,z=-4.5+random()*6.2;if(Math.abs(x+15)>1.5&&Math.abs(z+1.4)>1.2)prop(createTree,x,z,{size:.55+random()*.55});}
  for(let i=0;i<5;i++){box(city,1,.22,.75,-17.8+i*1.25,.34,5.30,grass);prop(createTree,-17.8+i*1.25,5.3,{size:.9});}
  // Streetscape, rooftop greenery, lamps and planted sidewalk pockets.
  for(const x of [-11.7,1.7,8.3])for(let z=-15;z<4;z+=3.8){prop(createTree,x,z,{size:.64+random()*.25});prop(createStreetLamp,x-.30,z+1.7);}
  for(let x=-18;x<20;x+=3.6){prop(createTree,x,4.6,{size:.75});if(x>-8)prop(createPlanter,x,5.65);}
  for(let x=-17;x<20;x+=6){prop(createTree,x,-16,{size:.76});}
  // Quiet jetty and two small moorings.
  box(city,1.4,.22,5.5,-6,.13,10.9,mat('#ae9478'));
  for(let z=8.5;z<13.6;z+=.28)box(city,1.4,.035,.04,-6,.26,z,mat('#877960'));
  for(let z=8.3;z<13.7;z+=1.3)for(const x of [-6.72,-5.28])cylinder(city,.075,.9,x,.13,z,mat('#8c8a72'));
  box(city,5,.20,1.2,-6,.13,13.4,mat('#b29a7e'));
  // Slim arched bridge spans the water, backed by structural piers.
  box(city,2.15,.24,9.3,10,.82,12.55,mat('#d9d5bf'));
  box(city,1.6,.07,9.3,10,.98,12.55,asphalt);
  for(const x of [8.98,11.02]){
    box(city,.06,.045,9.3,x,1.65,12.55,mat('#87978a'));
    for(let z=8.15;z<17.2;z+=.65)box(city,.045,.65,.045,x,1.30,z,mat('#8d9d8f'));
  }
  for(const z of [9.2,15.8]){box(city,1.25,1.2,.75,10,.18,z,mat('#aeb6a5'));}
  for(let z=8.6;z<17;z+=1.7)box(city,.04,.01,.7,10,1.03,z,white);
  // Static figures, just enough life to be discovered at closer range.
  const normalCanvas=document.createElement('canvas');normalCanvas.width=256;normalCanvas.height=256;const normalContext=normalCanvas.getContext('2d');const image=normalContext.createImageData(256,256);
  for(let y=0;y<256;y++)for(let x=0;x<256;x++){const i=(y*256+x)*4;image.data[i]=128+Math.sin(x*.12+y*.35)*18+Math.sin(x*.51-y*.08)*9;image.data[i+1]=128+Math.sin(x*.27-y*.18)*15;image.data[i+2]=250;image.data[i+3]=255;}normalContext.putImageData(image,0,0);
  const normalMap=new THREE.CanvasTexture(normalCanvas);normalMap.wrapS=normalMap.wrapT=THREE.RepeatWrapping;normalMap.repeat.set(8,2);
  water=new THREE.Mesh(new THREE.PlaneGeometry(41.1,9.6),new THREE.MeshPhysicalMaterial({color:'#173944',metalness:.35,roughness:.17,normalMap,normalScale:new THREE.Vector2(.24,.24),clearcoat:.8,clearcoatRoughness:.15}));water.rotation.x=-Math.PI/2;water.position.set(0,.015,12.55);scene.add(water);
  // Water-edge retaining wall, designed in separate cut stone sections.
  for(let x=-20;x<20;x+=1.25)box(city,1.23,.5,.20,x+.62,-.16,8.25,mat('#c3c3ac'));
  // Collect all static geometry into GPU instance batches before moving objects.
  city.scale.setScalar(WORLD_SCALE);water.scale.setScalar(WORLD_SCALE);water.position.multiplyScalar(WORLD_SCALE);
  batchStatic(city);
  createMovement();
}

function batchStatic(group) {
  group.updateMatrixWorld(true);
  const batches = new Map();
  group.traverse(node=>{
    if(!node.isMesh)return;
    const key=node.geometry.uuid+'-'+(Array.isArray(node.material)?node.material.map(m=>m.uuid).join('-'):node.material.uuid);
    if(!batches.has(key))batches.set(key,{geometry:node.geometry,material:node.material,items:[]});
    batches.get(key).items.push({matrix:node.matrixWorld.clone(),landmark:node.userData.landmark,shadow:node.castShadow,collision:node.geometry===unitBox&&node.scale.y>2&&node.scale.x>1&&node.scale.z>1&&!!node.userData.landmark});
  });
  group.clear();group.scale.set(1,1,1);group.updateMatrixWorld(true);
  for(const batch of batches.values()){
    const instances=new THREE.InstancedMesh(batch.geometry,batch.material,batch.items.length);
    instances.castShadow=batch.items.some(i=>i.shadow);instances.receiveShadow=true;
    instances.userData.landmarks=batch.items.map(i=>i.landmark||null);
    batch.items.forEach((item,index)=>instances.setMatrixAt(index,item.matrix));
    batch.items.forEach((item,index)=>{if(item.collision){const center=new THREE.Vector3(),scale=new THREE.Vector3();item.matrix.decompose(center,new THREE.Quaternion(),scale);colliders.push({object:instances,index,center,scale});}});
    instances.computeBoundingSphere();group.add(instances);if(batch.items.some(i=>i.landmark))staticMeshes.push(instances);
  }
}

function optimizeMoving(group) {
  group.updateMatrixWorld(true);
  const byMaterial=new Map();
  group.traverse(node=>{
    if(!node.isMesh)return;
    const geometry=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();
    geometry.applyMatrix4(node.matrixWorld);
    if(!byMaterial.has(node.material.uuid))byMaterial.set(node.material.uuid,{material:node.material,geometries:[]});
    byMaterial.get(node.material.uuid).geometries.push(geometry);
  });
  group.clear();
  for(const batch of byMaterial.values()){
    const geometry=mergeGeometries(batch.geometries,false);
    batch.geometries.forEach(g=>g.dispose());
    if(geometry){const mesh=new THREE.Mesh(geometry,batch.material);mesh.receiveShadow=true;group.add(mesh);}
  }
  return group;
}
function createMovement() {
  const colors=['#d6c5a7','#637e72','#c68f72','#e4dfcd','#859b9b','#bdad91'];
  for(let i=0;i<8;i++){
    const car=optimizeMoving(createCar(colors[i%colors.length]));car.scale.setScalar(4.1);scene.add(car);
    vehicles.push({object:car,offset:i*6.7,speed:1.4+random()*.7,axis:i%2?'x':'z',lane:i%2?3.46:9.57,direction:i%3===0?-1:1});
  }
  for(let i=0;i<3;i++){
    const boat=optimizeMoving(createBoat());boat.scale.setScalar((i===0?.92:.73)*WORLD_SCALE);scene.add(boat);
    boats.push({object:boat,offset:i*12,moored:i>0,lane:i===0?14.8:12.1+i*.35});
  }
  const birdMaterial=new THREE.LineBasicMaterial({color:'#667c71',transparent:true,opacity:.70});
  for(let i=0;i<5;i++){
    const shape=new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-.22,0,.1),new THREE.Vector3(0,.07,0),new THREE.Vector3(.22,0,.1)]);
    const bird=new THREE.Line(shape,birdMaterial);scene.add(bird);birds.push(bird);
  }
}

const keys=new Set(),stick=new THREE.Vector2(),npcList=[],projectiles=[],colliders=[];
let hero, playerCar, destruction, composer, bloom, flightTrail, attackCooldown=0, landedAt=.22*WORLD_SCALE, flyHeight=14;
let flying=false, driving=false, freeCamera=false, followInitialized=false, kills=0, health=100;
const spawn=new THREE.Vector3(1.5*WORLD_SCALE,.22*WORLD_SCALE,6.25*WORLD_SCALE),facing=new THREE.Vector3(0,0,-1),velocity=new THREE.Vector3();
const lastFollow=new THREE.Vector3(), targetFollow=new THREE.Vector3(),tmpV=new THREE.Vector3();
const lookDirection=new THREE.Vector3(),rightDirection=new THREE.Vector3(),movement=new THREE.Vector3();
let audioContext,audioGain;
const projectileGeometry=new THREE.SphereGeometry(.12,8,6),projectileMaterial=new THREE.MeshBasicMaterial({color:'#a7ffff',toneMapped:false});
const coreGlowMaterial=new THREE.MeshBasicMaterial({color:'#62eced',transparent:true,opacity:.25,toneMapped:false,depthWrite:false});

function initialPosition(){
  const target=new THREE.Vector3(0,5*WORLD_SCALE,0),direction=new THREE.Vector3(1,.82,1.16).normalize();
  const distance=Math.max(220,126/(Math.tan(THREE.MathUtils.degToRad(48)/2)*camera.aspect));
  return {position:target.clone().addScaledVector(direction,distance),target};
}
function flyingState(){
  $('flight-toggle').classList.toggle('active',flying);$('flight-toggle').setAttribute('aria-pressed',String(flying));
  $('enter-vehicle').classList.toggle('active',driving);$('enter-vehicle').setAttribute('aria-pressed',String(driving));
  $('mode-indicator').hidden=!flying&&!driving;$('mode-indicator').setAttribute('aria-label',driving?'Driving':'Flying');
  $('mode-icon').setAttribute('href',driving?'#icon-car':'#icon-flight');
}
function toggleFlight(){
  if(driving)toggleVehicle();flying=!flying;flyHeight=Math.max(hero.group.position.y+5,14);
  if(!flying)landedAt=surfaceHeight(hero.group.position);
  flyingState();
}
function toggleVehicle(){
  if(driving){driving=false;hero.group.visible=true;hero.group.position.copy(playerCar.position).add(new THREE.Vector3(1.3,0,0));hero.group.position.y=.22*WORLD_SCALE;}
  else{flying=false;driving=true;hero.group.visible=false;playerCar.visible=true;playerCar.position.copy(hero.group.position);playerCar.position.y=.28*WORLD_SCALE;playerCar.rotation.y=hero.group.rotation.y+Math.PI/2;landedAt=.22*WORLD_SCALE;hero.group.position.y=.22*WORLD_SCALE;}
  flyingState();
}
function surfaceHeight(position){return getSurfaceHeight(position,{colliders,destruction,worldScale:WORLD_SCALE});}
function blocked(position,margin=.3){return blockedByBuilding(position,{colliders,destruction,margin});}
function killNPC(npc,direction){
  if(npc.dead)return;npc.dead=true;npc.deathTime=elapsed;npc.knock.copy(direction).multiplyScalar(3);kills++;
}
function fireAttack(target){
  if(attackCooldown>0)return;attackCooldown=.30;$('attack').classList.add('active');setTimeout(()=>$('attack').classList.remove('active'),160);
  const origin=hero.group.position.clone().add(new THREE.Vector3(0,driving?.5:1.1,0));
  let direction=facing.clone();
  if(target)direction.copy(target).sub(origin).normalize();
  else{
    let closest=null,best=7;
    for(const npc of npcList){if(npc.dead)continue;const d=npc.group.position.distanceTo(hero.group.position);if(d<best){best=d;closest=npc;}}
    if(closest)direction.copy(closest.group.position).add(new THREE.Vector3(0,.8,0)).sub(origin).normalize();
  }
  origin.addScaledVector(direction,.6);facing.copy(direction).setY(0).normalize();
  const object=new THREE.Group();object.add(new THREE.Mesh(projectileGeometry,projectileMaterial));
  const aura=new THREE.Mesh(projectileGeometry,coreGlowMaterial);aura.scale.setScalar(2.8);object.add(aura);object.position.copy(origin);scene.add(object);
  projectiles.push({object,direction,life:1.7,previous:origin.clone()});
  if(projectiles.length>14){scene.remove(projectiles.shift().object);}
  // A close-range strike can knock down nearby civilians and break a facade.
  for(const npc of npcList)if(!npc.dead&&npc.group.position.distanceTo(origin)<2.2)killNPC(npc,direction);
  const count=destruction.destroyNear(origin.clone().addScaledVector(direction,1.6),1.2,.5);if(count)sun.shadow.needsUpdate=true;
}
function attackAt(event){
  if(freeCamera)return;
  const rect=canvas.getBoundingClientRect();const pointer=new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  const ray=new THREE.Raycaster();ray.setFromCamera(pointer,camera);
  const hits=ray.intersectObjects(staticMeshes,false).filter(hit=>!destruction.isDestroyed(hit.object,hit.instanceId));
  let target=hits[0]?.point;
  if(!target){target=new THREE.Vector3();ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),-.3),target);if(target.length()===0)target=null;}
  fireAttack(target);
}
function followCamera(force=false){
  targetFollow.copy(hero.group.position).add(new THREE.Vector3(0,flying?1.0:1.15,0));
  if(force){controls.target.copy(targetFollow);const portrait=camera.aspect<.7;camera.position.copy(targetFollow).add(new THREE.Vector3(portrait?3.5:4.5,portrait?4:3.6,portrait?10:8.5));lastFollow.copy(targetFollow);controls.update();followInitialized=true;return;}
  if(freeCamera)return;
  tmpV.copy(targetFollow).sub(lastFollow);camera.position.add(tmpV);controls.target.add(tmpV);lastFollow.copy(targetFollow);
}
function respawn(){
  flying=false;driving=false;hero.group.visible=true;hero.group.position.copy(spawn);hero.group.rotation.set(0,0,0);landedAt=.22*WORLD_SCALE;velocity.set(0,0,0);facing.set(0,0,-1);
  playerCar.visible=false;freeCamera=false;controls.autoRotate=false;$('auto-rotate').setAttribute('aria-pressed','false');$('auto-rotate').classList.remove('active');
  destruction.reset();sun.shadow.needsUpdate=true;projectiles.forEach(p=>scene.remove(p.object));projectiles.length=0;
  for(const npc of npcList){npc.dead=false;npc.group.rotation.set(0,0,0);npc.group.position.copy(npc.spawn);}
  health=100;kills=0;flyingState();followCamera(true);
}
function setFreeCamera(){
  freeCamera=!freeCamera;$('auto-rotate').classList.toggle('active',freeCamera);$('auto-rotate').setAttribute('aria-pressed',String(freeCamera));
  controls.maxDistance=freeCamera?650:80;controls.enablePan=freeCamera;
  if(freeCamera){const fit=initialPosition();camera.position.copy(fit.position);controls.target.copy(fit.target);controls.autoRotate=!reducedMotion.matches;}
  else{controls.autoRotate=false;followCamera(true);}
}
function zoom(factor){const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);}
async function toggleSound(){
  if(!audioContext){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;audioContext=new Audio();audioGain=audioContext.createGain();audioGain.gain.value=0;audioGain.connect(audioContext.destination);
    const buffer=audioContext.createBuffer(1,audioContext.sampleRate*4,audioContext.sampleRate),data=buffer.getChannelData(0);let last=0;
    for(let i=0;i<data.length;i++){last=(last+(Math.random()*2-1)*.02)/1.025;data[i]=last*3;}
    const source=audioContext.createBufferSource();source.buffer=buffer;source.loop=true;const filter=audioContext.createBiquadFilter();filter.type='lowpass';filter.frequency.value=420;source.connect(filter);filter.connect(audioGain);source.start();
  }
  await audioContext.resume();state.sound=!state.sound;audioGain.gain.setTargetAtTime(state.sound?.14:0,audioContext.currentTime,.5);
  $('sound-toggle').setAttribute('aria-pressed',String(state.sound));$('sound-toggle').setAttribute('aria-label',state.sound?'Mute city sounds':'Enable city sounds');
}
function bindControls(){
  $('flight-toggle').onclick=toggleFlight;$('enter-vehicle').onclick=toggleVehicle;$('attack').onclick=()=>fireAttack();
  $('auto-rotate').onclick=setFreeCamera;$('reset-view').onclick=respawn;$('zoom-in').onclick=()=>zoom(.88);$('zoom-out').onclick=()=>zoom(1.14);
  $('sound-toggle').onclick=()=>toggleSound().catch(()=>{});$('help-toggle').onclick=()=>{$('help-panel').hidden=!$('help-panel').hidden;$('help-toggle').setAttribute('aria-expanded',String(!$('help-panel').hidden));};
  window.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','f','e','q','r','shift'].includes(key)){event.preventDefault();keys.add(key);}
    if(event.repeat)return;if(key==='f')toggleFlight();if(key==='e')toggleVehicle();if(key===' ')fireAttack();if(key==='escape'){$('help-panel').hidden=true;$('help-toggle').setAttribute('aria-expanded','false');}if(key==='c')setFreeCamera();
  });window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));window.addEventListener('blur',()=>{keys.clear();stick.set(0,0);});
  bindCanvasSelection(canvas,attackAt,()=>{});
  const joystick=$('joystick'),knob=$('joystick-knob');let joystickPointer=null;
  const move=event=>{if(event.pointerId!==joystickPointer)return;const rect=joystick.getBoundingClientRect(),radius=rect.width*.34;let x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2;const distance=Math.hypot(x,y);if(distance>radius){x*=radius/distance;y*=radius/distance;}stick.set(x/radius,y/radius);knob.style.transform=`translate(${x}px,${y}px)`;};
  joystick.addEventListener('pointerdown',event=>{if(joystickPointer!==null)return;joystickPointer=event.pointerId;joystick.setPointerCapture(event.pointerId);move(event);});joystick.addEventListener('pointermove',move);
  const release=event=>{if(event.pointerId!==joystickPointer)return;joystickPointer=null;stick.set(0,0);knob.style.transform='translate(0,0)';};joystick.addEventListener('pointerup',release);joystick.addEventListener('pointercancel',release);joystick.addEventListener('lostpointercapture',release);
  window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{state.visible=!document.hidden;keys.clear();stick.set(0,0);if(state.visible){lastFrame=performance.now();clock.getDelta();if(!animation)animation=requestAnimationFrame(render);}else{cancelAnimationFrame(animation);animation=null;}if(audioGain)audioGain.gain.setTargetAtTime(state.visible&&state.sound?.14:0,audioContext.currentTime,.3);});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(animation);$('fallback').hidden=false;});canvas.addEventListener('webglcontextrestored',()=>location.reload());
  reducedMotion.addEventListener('change',()=>{controls.autoRotate=freeCamera&&!reducedMotion.matches;});
}
function resize(){camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();renderer.setSize(window.innerWidth,window.innerHeight);renderer.setPixelRatio(Math.min(window.devicePixelRatio,qualityReduced?1:smallScreen()?1.25:1.5));composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(window.innerWidth,window.innerHeight);if(!freeCamera)followCamera(true);}
let elapsed=0;
function updatePlayer(dt){
  const player=hero.group.position;
  lookDirection.copy(controls.target).sub(camera.position);lookDirection.y=0;lookDirection.normalize();rightDirection.crossVectors(lookDirection,new THREE.Vector3(0,1,0));
  const forward=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0)-stick.y;
  const sideways=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0)+stick.x;
  movement.copy(lookDirection).multiplyScalar(forward).addScaledVector(rightDirection,sideways);if(movement.length()>1)movement.normalize();
  const active=!freeCamera;const speed=driving?9:flying?(keys.has('shift')?18:10):(keys.has('shift')?6:3.7);
  const goal=movement.multiplyScalar(active?speed:0);velocity.lerp(goal,1-Math.exp(-dt*(driving?3.5:8)));
  const old=player.clone();let next=old.clone().addScaledVector(velocity,dt);
  next.x=THREE.MathUtils.clamp(next.x,-90,90);next.z=THREE.MathUtils.clamp(next.z,-81,54);
  if(flying){
    if(keys.has('r'))flyHeight+=dt*7;if(keys.has('q'))flyHeight-=dt*7;flyHeight=THREE.MathUtils.clamp(flyHeight,1.5,80);
    const top=surfaceHeight(next);if(top>next.y-.5)flyHeight=Math.max(flyHeight,top+2.2);
    next.y=THREE.MathUtils.damp(player.y,flyHeight,1.7,dt);
    if(blocked(next,.25)){next.x=old.x;next.z=old.z;}
  }else{
    const constrained=constrainGroundMove(old,next,{colliders,destruction,driving,heading:hero.group.rotation.y,worldScale:WORLD_SCALE});
    if(driving&&constrained.distanceToSquared(next)>.0001){velocity.multiplyScalar(.40);health=Math.max(10,health-dt*5);}
    next.copy(constrained);
    const floor=surfaceHeight(next);if(floor<landedAt-.3)landedAt=floor;next.y=THREE.MathUtils.damp(player.y,landedAt,5,dt);
  }
  player.copy(next);
  if(velocity.length()>.15){facing.copy(velocity).normalize();const heading=Math.atan2(-facing.x,-facing.z);let diff=THREE.MathUtils.euclideanModulo(heading-hero.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;hero.group.rotation.y+=diff*Math.min(1,dt*9);}
  hero.animate(elapsed,Math.min(1,velocity.length()/3.7),flying&&!driving);
  if(driving){playerCar.position.copy(player).setY(driving&&player.z>=8*WORLD_SCALE?1.03*WORLD_SCALE:.16*WORLD_SCALE);playerCar.rotation.y=hero.group.rotation.y+Math.PI/2;}
  flightTrail.visible=flying;flightTrail.position.copy(player).add(new THREE.Vector3(0,.35,0));flightTrail.material.opacity=.35+Math.sin(elapsed*8)*.1;
  $('health-fill').style.width=`${health}%`;$('health-fill').parentElement.parentElement.setAttribute('aria-valuenow',String(Math.round(health)));
  const mapX=THREE.MathUtils.clamp(50+player.x*1.7/WORLD_SCALE,8,92),mapY=THREE.MathUtils.clamp(50+player.z*1.7/WORLD_SCALE,8,92);$('map-player').setAttribute('transform',`translate(${mapX-50} ${mapY-52}) rotate(${-hero.group.rotation.y*180/Math.PI} 50 52)`);
  followCamera();
}
function updateProjectiles(dt){
  const ray=new THREE.Raycaster();
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i];p.life-=dt;p.previous.copy(p.object.position);p.object.position.addScaledVector(p.direction,dt*32);
    let impact=false;
    for(const npc of npcList)if(!npc.dead&&npc.group.position.clone().add(new THREE.Vector3(0,.8,0)).distanceTo(p.object.position)<.8){killNPC(npc,p.direction);impact=true;break;}
    if(!impact){ray.set(p.previous,p.direction);ray.far=dt*32+.2;const hits=ray.intersectObjects(staticMeshes,false);const hit=hits.find(h=>h.object.userData.landmarks[h.instanceId]&&h.object.userData.landmarks[h.instanceId]!=='gardens'&&!destruction.isDestroyed(h.object,h.instanceId));if(hit){const count=destruction.destroyNear(hit.point,3.0,1.4);if(count)sun.shadow.needsUpdate=true;impact=true;}}
    if(impact||p.life<0){scene.remove(p.object);projectiles.splice(i,1);}
  }
}
function updateNPCs(dt){
  for(const npc of npcList){
    if(npc.dead){npc.group.rotation.x=THREE.MathUtils.damp(npc.group.rotation.x,-Math.PI/2,8,dt);npc.group.position.addScaledVector(npc.knock,dt);npc.knock.multiplyScalar(Math.exp(-dt*4));npc.group.position.y=.22*WORLD_SCALE;if(elapsed-npc.deathTime>22){npc.dead=false;npc.group.rotation.x=0;npc.group.position.copy(npc.spawn);}continue;}
    npc.group.position.x+=npc.speed*dt;if(Math.abs(npc.group.position.x)>18.5*WORLD_SCALE)npc.speed*=-1;npc.group.rotation.y=npc.speed>0?-Math.PI/2:Math.PI/2;npc.animate(elapsed,Math.abs(npc.speed));
  }
}
function render(now){
  if(!state.visible)return;animation=requestAnimationFrame(render);const dt=Math.min(clock.getDelta(),.045);elapsed+=dt;const frame=Math.min(now-lastFrame,200);lastFrame=now;frameEMA=frameEMA*.96+frame*.04;
  if(frameEMA>31)slowFrames++;else slowFrames=Math.max(0,slowFrames-2);if(slowFrames>160&&!qualityReduced){qualityReduced=true;renderer.setPixelRatio(1);composer.setPixelRatio(1);bloom.enabled=false;}
  attackCooldown=Math.max(0,attackCooldown-dt);if(keys.has(' '))fireAttack();updatePlayer(dt);updateProjectiles(dt);updateNPCs(dt);if(destruction.update(dt))sun.shadow.needsUpdate=true;
  if(!reducedMotion.matches){if(water.material.normalMap)water.material.normalMap.offset.set(elapsed*.006,elapsed*.002);for(const v of vehicles){const position=((elapsed*v.speed*v.direction+v.offset+1000)%38)-19;if(v.axis==='x'){v.object.position.set(position*WORLD_SCALE,.16*WORLD_SCALE,v.lane*WORLD_SCALE);v.object.rotation.y=v.direction===1?0:Math.PI;}else{v.object.position.set(v.lane*WORLD_SCALE,.16*WORLD_SCALE,(position*.64-5)*WORLD_SCALE);v.object.rotation.y=v.direction===1?-Math.PI/2:Math.PI/2;}}boats.forEach((b,i)=>{b.object.position.set((b.moored?-8+i*1.75:((elapsed*.4+b.offset+20)%40)-20)*WORLD_SCALE,.10*WORLD_SCALE+Math.sin(elapsed*1.2+i)*.024,b.lane*WORLD_SCALE);b.object.rotation.z=Math.sin(elapsed*.85+i)*.014;b.object.rotation.y=b.moored?Math.PI/2:0;});birds.forEach((bird,i)=>{const angle=elapsed*.09+i*.22;bird.position.set((Math.cos(angle)*12-3)*WORLD_SCALE,(13+i*.7)*WORLD_SCALE,(Math.sin(angle)*8-5)*WORLD_SCALE);bird.rotation.y=-angle;});}
  controls.update(dt);renderer.info.reset();composer.render();
}
function init(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(window.devicePixelRatio,smallScreen()?1.25:1.5));renderer.setSize(innerWidth,innerHeight);renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.03;
  scene=new THREE.Scene();scene.background=new THREE.Color('#0b1522');scene.fog=new THREE.Fog('#0b1522',140,550);camera=new THREE.PerspectiveCamera(56,innerWidth/innerHeight,.1,1000);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.065;controls.enablePan=false;controls.minDistance=7;controls.maxDistance=80;controls.maxPolarAngle=Math.PI*.47;controls.minPolarAngle=.12;controls.rotateSpeed=.48;controls.zoomSpeed=.6;controls.autoRotateSpeed=.35;
  fill=new THREE.HemisphereLight('#739bbf','#24263b',.65);scene.add(fill);
  sun=new THREE.DirectionalLight('#b6d5ff',.9);sun.position.set(-66,105,36);sun.castShadow=true;sun.shadow.mapSize.set(smallScreen()?1024:2048,smallScreen()?1024:2048);sun.shadow.camera.left=-102;sun.shadow.camera.right=102;sun.shadow.camera.top=102;sun.shadow.camera.bottom=-102;sun.shadow.camera.near=1;sun.shadow.camera.far=320;sun.shadow.normalBias=.045;sun.shadow.bias=-.0003;sun.shadow.radius=3;scene.add(sun);
  const rim=new THREE.DirectionalLight('#8ae4e3',.7);rim.position.set(60,48,-54);scene.add(rim);
  ground=new THREE.Mesh(new THREE.PlaneGeometry(2000,2000),mat('#101c2b'));ground.rotation.x=-Math.PI/2;ground.position.y=-1.53*WORLD_SCALE;ground.receiveShadow=true;scene.add(ground);
  environment();scene.environmentIntensity=.14;buildCity();emissiveMaterials.forEach(m=>m.emissiveIntensity=1.35);
  sun.shadow.autoUpdate=false;sun.shadow.needsUpdate=true;destruction=createDestructionSystem(scene,staticMeshes);
  hero=createHero();hero.group.position.copy(spawn);scene.add(hero.group);playerCar=optimizeMoving(createCar('#5d7787'));playerCar.scale.setScalar(4.1);playerCar.visible=false;scene.add(playerCar);
  for(const z of [-.17,.17]){const headlight=new THREE.SpotLight('#d7e9ff',85,34,.43,.65,1.3);headlight.position.set(.53,.24,z);const target=new THREE.Object3D();target.position.set(8,.03,z);playerCar.add(target);headlight.target=target;playerCar.add(headlight);}

  const heroLight=new THREE.PointLight('#98e5ee',1.8,5,2);heroLight.position.set(0,1.9,1.0);hero.group.add(heroLight);
  for(let i=0;i<8;i++){const npc=createNPC(i);npc.group.position.set((-15+i*4.0)*WORLD_SCALE,.22*WORLD_SCALE,(i%2?4.7:6.2)*WORLD_SCALE);npc.spawn=npc.group.position.clone();npc.speed=(i%2?1:-1)*(.4+i%3*.08);npc.dead=false;npc.knock=new THREE.Vector3();npcList.push(npc);scene.add(npc.group);}
  const flareCanvas=document.createElement('canvas');flareCanvas.width=64;flareCanvas.height=64;const ctx=flareCanvas.getContext('2d'),g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(117,232,255,1)');g.addColorStop(.2,'rgba(78,209,235,.5)');g.addColorStop(1,'rgba(57,166,200,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
  flightTrail=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(flareCanvas),color:'#a3e9fa',transparent:true,opacity:.3,depthWrite:false,blending:THREE.AdditiveBlending}));flightTrail.scale.set(2.4,2.4,1);flightTrail.visible=false;scene.add(flightTrail);
  // A few warm practical lights add depth without expensive shadow passes.
  for(const p of [[-15,2,-1.4],[14.5,2,7.7],[-6,1.8,8.2]]){const light=new THREE.PointLight('#ffb76c',55,20,2);light.position.set(...p.map(n=>n*WORLD_SCALE));scene.add(light);}
  composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.38,.55,1.1);composer.addPass(bloom);composer.addPass(new OutputPass());
  bindControls();followCamera(true);clock=new THREE.Clock();lastFrame=performance.now();animation=requestAnimationFrame(render);
  requestAnimationFrame(()=>{document.body.classList.add('loaded');$('loader').classList.add('is-loaded');setTimeout(()=>$('loader').hidden=true,800);});
  window.cityExperience={getStats:()=>({drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),mode:driving?'driving':flying?'flying':'walking',hero:hero.group.position.toArray().map(n=>Math.round(n*100)/100),npcAlive:npcList.filter(n=>!n.dead).length,kills,destroyed:destruction.destroyedInstances.size,projectiles:projectiles.length,freeCamera,frameMS:Math.round(frameEMA),reducedMotion:reducedMotion.matches,health,worldScale:WORLD_SCALE,colliderCount:colliders.length,velocity:velocity.toArray().map(n=>Math.round(n*100)/100),keys:[...keys]})};
}
try{init();}catch(error){console.error('Westhaven could not initialize:',error);$('loader').hidden=true;$('fallback').hidden=false;}
