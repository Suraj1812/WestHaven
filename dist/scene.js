import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { HDRLoader } from './vendor/loaders/HDRLoader.js';
import { createHero, createNPC } from './characters.js';
import { createCar, createBoat } from './details.js';
import { createOpenWorld } from './world.js';
import { createInterior } from './interiors.js';
import { createTraffic } from './traffic.js';
import { createDestructionSystem } from './destruction.js';
import { constrainGroundMove, getSurfaceHeight, groundHeight, groundFootprintSupported, blockedByBuilding, cameraClearance } from './physics.js';
import { EffectComposer } from './vendor/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/postprocessing/OutputPass.js';
import { bindCanvasSelection } from './pointer.js';

const $=id=>document.getElementById(id),canvas=$('city-canvas');
const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)'),smallScreen=()=>innerWidth<700;
const state={sound:false,visible:true};
const keys=new Set(),stick=new THREE.Vector2(),npcList=[],projectiles=[],colliders=[],staticMeshes=[];
const spawn=new THREE.Vector3(),facing=new THREE.Vector3(0,0,-1),velocity=new THREE.Vector3();
const lookDirection=new THREE.Vector3(),rightDirection=new THREE.Vector3(),movement=new THREE.Vector3(),movementBasis=new THREE.Vector3(0,0,-1);
const projectileGeometry=new THREE.SphereGeometry(.12,8,6),projectileMaterial=new THREE.MeshBasicMaterial({color:'#a7ffff',toneMapped:false});
const coreGlowMaterial=new THREE.MeshBasicMaterial({color:'#62eced',transparent:true,opacity:.25,toneMapped:false,depthWrite:false});
let renderer,scene,camera,controls,sun,clock,animation,world,hero,playerCar,destruction,composer,bloom,flightTrail,traffic,water,overviewCity;
let elapsed=0,lastFrame=0,frameEMA=16,slowFrames=0,qualityReduced=false,attackCooldown=0,flyHeight=14;
let flying=false,driving=false,freeCamera=false,kills=0,health=100,interior=null,nearInteraction=null;
let manualCameraUntil=0,inputWasActive=false,verticalSpeed=0,carSpeed=0,cameraDistance=8.5,lastShadowPosition=new THREE.Vector3(1e6,0,0);
let audioContext,audioGain;
const outsideObjects=[],interiorStates=new Map(),boats=[];
let textures={},nextDetailUpdate=0;

function batchStatic(group){
  group.updateMatrixWorld(true);const batches=new Map(),coarseBatches=new Map();
  group.traverse(node=>{
    if(!node.isMesh)return;
    const center=new THREE.Vector3().setFromMatrixPosition(node.matrixWorld);
    const materials=Array.isArray(node.material)?node.material.map(m=>m.uuid).join('-'):node.material.uuid;
    const detail=!node.userData.buildingMass&&!node.userData.roofSupport&&node.geometry.type!=='ConeGeometry'&&node.geometry.type!=='ExtrudeGeometry'&&node.geometry.type!=='IcosahedronGeometry'&&!(node.scale.x>40||node.scale.z>40)&&!(node.scale.x>4&&node.scale.z>4&&center.y>3);
    const key=node.geometry.uuid+'-'+materials+'-'+detail+'-'+Math.floor(center.x/180)+':'+Math.floor(center.z/180);
    if(!batches.has(key))batches.set(key,{geometry:node.geometry,material:node.material,detail,items:[]});
    const item={matrix:node.matrixWorld.clone(),landmark:node.userData.landmark||null,collision:!!node.userData.collision,shadow:node.castShadow,mass:!!node.userData.buildingMass};batches.get(key).items.push(item);
    if(!detail){const coarseKey=node.geometry.uuid+'-'+materials;if(!coarseBatches.has(coarseKey))coarseBatches.set(coarseKey,{geometry:node.geometry,material:node.material,items:[]});coarseBatches.get(coarseKey).items.push(item);}
  });
  group.clear();group.scale.set(1,1,1);group.position.set(0,0,0);group.rotation.set(0,0,0);group.updateMatrixWorld(true);
  for(const batch of batches.values()){
    const mesh=new THREE.InstancedMesh(batch.geometry,batch.material,batch.items.length);mesh.castShadow=batch.items.some(i=>i.shadow);mesh.receiveShadow=true;
    mesh.userData.detail=batch.detail;mesh.userData.landmarks=batch.items.map(i=>i.landmark);
    batch.items.forEach((item,index)=>{mesh.setMatrixAt(index,item.matrix);item.primaryMesh=mesh;item.primaryIndex=index;if(item.collision){const center=new THREE.Vector3(),scale=new THREE.Vector3();item.matrix.decompose(center,new THREE.Quaternion(),scale);colliders.push({object:mesh,index,center,scale,buildingId:item.landmark,mass:item.mass});}});
    mesh.computeBoundingSphere();mesh.userData.center=mesh.boundingSphere.center.clone();group.add(mesh);if(batch.items.some(i=>i.landmark))staticMeshes.push(mesh);
  }
  overviewCity=new THREE.Group();overviewCity.visible=false;scene.add(overviewCity);
  for(const batch of coarseBatches.values()){const mesh=new THREE.InstancedMesh(batch.geometry,batch.material,batch.items.length);batch.items.forEach((item,index)=>mesh.setMatrixAt(index,item.matrix));mesh.userData.sources=batch.items;mesh.computeBoundingSphere();overviewCity.add(mesh);}
}
function syncOverview(){const matrix=new THREE.Matrix4();for(const mesh of overviewCity.children){mesh.userData.sources.forEach((item,index)=>{item.primaryMesh.getMatrixAt(item.primaryIndex,matrix);mesh.setMatrixAt(index,matrix);});mesh.instanceMatrix.needsUpdate=true;}}
function optimizeMoving(group){
  group.updateMatrixWorld(true);const batches=new Map();
  group.traverse(node=>{if(!node.isMesh)return;const geometry=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();geometry.applyMatrix4(node.matrixWorld);const key=node.material.uuid;if(!batches.has(key))batches.set(key,{material:node.material,geometries:[]});batches.get(key).geometries.push(geometry);});
  group.clear();for(const batch of batches.values()){const geometry=mergeGeometries(batch.geometries,false);batch.geometries.forEach(g=>g.dispose());if(geometry){const mesh=new THREE.Mesh(geometry,batch.material);mesh.castShadow=true;mesh.receiveShadow=true;group.add(mesh);}}return group;
}
function collisionOptions(){return{colliders:interior?interior.colliders:colliders,destruction:interior?null:destruction,bounds:interior?interior.bounds:world.worldBounds,waterAreas:interior?[]:world.waterAreas,bridges:interior?[]:world.bridgeAreas,floorY:interior?interior.floorY:.15};}
function surfaceHeight(position){
  let height=getSurfaceHeight(position,collisionOptions());if(interior)return height;
  for(const building of world.buildings){const roof=building.roofProfile;if(!roof||Math.abs(position.x-roof.centerX)>roof.halfWidth||Math.abs(position.z-roof.centerZ)>roof.halfDepth)continue;if(building.bodyCollider&&destruction.isDestroyed(building.bodyCollider.object,building.bodyCollider.index))continue;height=Math.max(height,roof.heightAt(position)+.025);}
  return height;
}
function blocked(position,margin=.28){return blockedByBuilding(position,{...collisionOptions(),margin});}
function initialPosition(){const target=new THREE.Vector3(0,12,-55),distance=Math.max(1400,1150/camera.aspect);return{position:target.clone().addScaledVector(new THREE.Vector3(1,.95,1.15).normalize(),distance),target};}
function flyingState(){
  $('flight-toggle').classList.toggle('active',flying);$('flight-toggle').setAttribute('aria-pressed',String(flying));$('flight-toggle').disabled=!!interior;
  $('enter-vehicle').classList.toggle('active',driving);$('enter-vehicle').setAttribute('aria-pressed',String(driving));$('enter-vehicle').disabled=!!interior;$('rise').hidden=$('descend').hidden=!flying;
  playerCar?.traverse(node=>{if(node.isSpotLight)node.visible=driving;});$('mode-indicator').hidden=!flying&&!driving;$('mode-indicator').setAttribute('aria-label',driving?'Driving':'Flying');$('mode-icon').setAttribute('href',driving?'#icon-car':'#icon-flight');
}
function toggleFlight(){if(interior)return;if(driving)toggleVehicle();flying=!flying;verticalSpeed=0;flyHeight=Math.max(hero.group.position.y+5,14);velocity.set(0,0,0);flyingState();}
function toggleVehicle(){
  if(interior)return;
  if(driving){
    driving=false;hero.group.visible=true;carSpeed=0;
    const side=new THREE.Vector3(Math.cos(hero.group.rotation.y),0,-Math.sin(hero.group.rotation.y));
    const next=playerCar.position.clone().addScaledVector(side,1.7);next.y=groundHeight(next,collisionOptions());
    hero.group.position.copy(constrainGroundMove(playerCar.position,next,{...collisionOptions(),heading:hero.group.rotation.y}));hero.group.position.y=groundHeight(hero.group.position,collisionOptions());
  }else{
    if(flying||hero.group.position.distanceTo(playerCar.position)>4.2)return;
    driving=true;hero.group.visible=false;hero.group.position.copy(playerCar.position);hero.group.rotation.y=playerCar.rotation.y-Math.PI/2;carSpeed=0;velocity.set(0,0,0);
  }
  flyingState();followCamera(true);
}
function visibleDoor(door){return !colliders.some(c=>c.buildingId===door.buildingId&&c.object&&destruction.isDestroyed(c.object,c.index)&&c.mass);}
function updateInteraction(){
  nearInteraction=null;let best=Infinity;const p=hero.group.position;
  if(interior){for(const item of interior.interactables){const distance=p.distanceTo(item.position);if(distance<(item.radius||2)&&distance<best){nearInteraction={kind:'object',item};best=distance;}}}
  else if(!flying&&!driving){for(const door of world.doors){const distance=p.distanceTo(door.position);if(distance<2.6&&distance<best&&visibleDoor(door)){nearInteraction={kind:'door',door};best=distance;}}}
  const button=$('interact');button.hidden=!nearInteraction;button.setAttribute('aria-label',nearInteraction?.kind==='door'?'Enter '+nearInteraction.door.building.name:nearInteraction?.item.label||'Interact');
  $('enter-vehicle').style.opacity=driving||(!flying&&!interior&&p.distanceTo(playerCar.position)<4.2)?'1':'.4';
}
function saveInterior(){if(!interior)return;interiorStates.set(interior.buildingId,interior.saveState());}
function enterBuilding(door){
  if(interior||driving||flying)return;
  overviewCity.visible=false;interior=createInterior(door.building,{textures});interior.buildingId=door.buildingId;interior.door=door;
  const saved=interiorStates.get(door.buildingId);if(saved)interior.loadState(saved);
  for(const object of outsideObjects)object.visible=false;traffic.group.visible=false;playerCar.visible=false;water.visible=false;
  scene.add(interior.group);hero.group.position.copy(interior.spawn);velocity.set(0,0,0);inputWasActive=false;freeCamera=false;controls.autoRotate=false;controls.enablePan=false;controls.minDistance=.4;controls.maxDistance=7;sun.visible=false;$('auto-rotate').classList.remove('active');$('auto-rotate').setAttribute('aria-pressed','false');
  const front=door.building.front||1;hero.group.rotation.y=front>0?0:Math.PI;facing.set(0,0,-front);scene.fog=null;sun.shadow.needsUpdate=true;flyingState();followCamera(true);
}
function exitBuilding(){
  if(!interior)return;saveInterior();const door=interior.door;scene.remove(interior.group);interior.dispose();interior=null;controls.minDistance=1.2;controls.maxDistance=60;sun.visible=true;
  outsideObjects.forEach(o=>o.visible=true);traffic.group.visible=true;playerCar.visible=true;water.visible=true;scene.fog=new THREE.Fog('#101b29',smallScreen()?120:190,smallScreen()?500:850);
  hero.group.position.copy(door.position).addScaledVector(door.building.doorFacing||new THREE.Vector3(0,0,door.building.front||1),1.2);hero.group.position.y=.15;velocity.set(0,0,0);hero.group.rotation.y=door.building.front>0?Math.PI:0;facing.copy(door.building.doorFacing);sun.shadow.needsUpdate=true;flyingState();followCamera(true);
}
function interact(){
  updateInteraction();if(driving){toggleVehicle();return;}if(!nearInteraction){toggleVehicle();return;}
  if(nearInteraction.kind==='door')enterBuilding(nearInteraction.door);
  else{const action=nearInteraction.item.action();if(action?.type==='exit')exitBuilding();if(action?.type==='rest')health=100;sun.shadow.needsUpdate=true;}
  updateInteraction();
}
function followCamera(force=false,dt=1/60){
  if(freeCamera)return;
  const p=hero.group.position,target=p.clone().add(new THREE.Vector3(0,driving?.85:1.2,0));
  if(velocity.length()>1)target.addScaledVector(facing,driving?.6:.25);
  if(force){
    const yaw=hero.group.rotation.y,portrait=camera.aspect<.7;cameraDistance=interior?(portrait?3.3:2.8):(portrait?9:8.5);
    const desired=target.clone().add(new THREE.Vector3(Math.sin(yaw)*cameraDistance+Math.cos(yaw)*(interior?.5:2),interior?.8:3.5,Math.cos(yaw)*cameraDistance-Math.sin(yaw)*(interior?.5:2)));
    controls.target.copy(target);camera.position.copy(cameraClearance(target,desired,collisionOptions()));controls.update();manualCameraUntil=0;return;
  }
  const previous=controls.target.clone(),alpha=1-Math.exp(-dt*9);controls.target.lerp(target,alpha);camera.position.add(controls.target.clone().sub(previous));
  if(elapsed>manualCameraUntil&&!reducedMotion.matches){
    const yaw=hero.group.rotation.y,offset=camera.position.clone().sub(controls.target),distance=THREE.MathUtils.clamp(Math.hypot(offset.x,offset.z),interior?2.2:4,interior?7:18);
    const behind=new THREE.Vector3(Math.sin(yaw)*distance+Math.cos(yaw)*(interior?.4:1.8),interior?.8:flying?6+Math.min(12,p.y*.09):driving?3.0:3.5,Math.cos(yaw)*distance-Math.sin(yaw)*(interior?.4:1.8));
    const desired=controls.target.clone().add(behind);camera.position.lerp(desired,1-Math.exp(-dt*(driving?2:1.5)));
  }
  camera.position.copy(cameraClearance(controls.target,camera.position,collisionOptions()));
}
function respawn(){
  if(interior)exitBuilding();overviewCity.visible=false;world.group.visible=true;flying=false;driving=false;hero.group.visible=true;hero.group.position.copy(spawn);hero.group.rotation.set(0,-Math.PI/2,0);velocity.set(0,0,0);carSpeed=0;facing.set(1,0,0);inputWasActive=false;
  playerCar.position.set(-21,.15,26.8);playerCar.rotation.set(0,Math.PI/2,0);playerCar.visible=true;freeCamera=false;controls.autoRotate=false;controls.maxDistance=60;controls.enablePan=false;$('auto-rotate').setAttribute('aria-pressed','false');$('auto-rotate').classList.remove('active');
  scene.fog=new THREE.Fog('#101b29',smallScreen()?120:190,smallScreen()?500:850);sun.castShadow=true;destruction.reset();traffic.reset();sun.shadow.needsUpdate=true;projectiles.forEach(p=>scene.remove(p.object));projectiles.length=0;health=100;kills=0;flyingState();followCamera(true);updateInteraction();
}
function setFreeCamera(){
  if(interior)return;freeCamera=!freeCamera;$('auto-rotate').classList.toggle('active',freeCamera);$('auto-rotate').setAttribute('aria-pressed',String(freeCamera));controls.maxDistance=freeCamera?1900:60;controls.enablePan=freeCamera;
  if(freeCamera){syncOverview();overviewCity.visible=true;world.group.visible=false;scene.fog=null;sun.castShadow=false;const fit=initialPosition();camera.position.copy(fit.position);controls.target.copy(fit.target);controls.autoRotate=!reducedMotion.matches;}else{overviewCity.visible=false;world.group.visible=true;scene.fog=new THREE.Fog('#101b29',smallScreen()?120:190,smallScreen()?500:850);sun.castShadow=true;sun.shadow.needsUpdate=true;controls.autoRotate=false;followCamera(true);}
}
function zoom(factor){const offset=camera.position.clone().sub(controls.target);offset.setLength(THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);manualCameraUntil=elapsed+3;}
function renderMap(){
  const svg=$('mini-map').querySelector('svg'),group=svg.querySelector('g[clip-path]');
  const x=n=>50+n/14,z=n=>50+n/12,ns='http://www.w3.org/2000/svg';const player=$('map-player');
  group.replaceChildren();
  const rect=(px,pz,w,d,fill)=>{const node=document.createElementNS(ns,'rect');for(const [key,value]of Object.entries({x:px,y:pz,width:w,height:d,fill}))node.setAttribute(key,String(value));group.append(node);};
  rect(5,z(430),90,12,'#214451');
  for(const b of world.buildings)rect(x(b.position.x-b.width/2),z(b.position.z-b.depth/2),b.width/14,b.depth/12,b.type==='house'||b.type==='townhouse'?'#344b51':'#4c6068');
  for(const line of world.roads.xLines)rect(x(line)-.45,5,.9,80,'#78959d');for(const line of world.roads.zLines)rect(5,z(line)-.5,90,1,'#78959d');
  for(const bridge of world.bridgeAreas)rect(x(bridge.x)-.5,z(395),1,15,'#7b969d');
  group.append(player);group.setAttribute('opacity','.7');player.setAttribute('fill','#a3ebe6');
}
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,qualityReduced?1:smallScreen()?1.25:1.5));composer.setPixelRatio(renderer.getPixelRatio());composer.setSize(innerWidth,innerHeight);if(!freeCamera)followCamera(true);}
function updatePlayer(dt){
  const player=hero.group.position;
  lookDirection.copy(controls.target).sub(camera.position).setY(0).normalize();
  const forward=(keys.has('w')||keys.has('arrowup')?1:0)-(keys.has('s')||keys.has('arrowdown')?1:0)-stick.y;
  const sideways=(keys.has('d')||keys.has('arrowright')?1:0)-(keys.has('a')||keys.has('arrowleft')?1:0)+stick.x;
  const hasInput=Math.abs(forward)+Math.abs(sideways)>.08;
  if(!inputWasActive||elapsed<manualCameraUntil)movementBasis.copy(lookDirection);inputWasActive=hasInput;
  rightDirection.crossVectors(movementBasis,new THREE.Vector3(0,1,0));movement.copy(movementBasis).multiplyScalar(forward).addScaledVector(rightDirection,sideways);if(movement.length()>1)movement.normalize();
  if(driving){
    carSpeed=THREE.MathUtils.damp(carSpeed,freeCamera?0:forward*18,forward?1.3:2.6,dt);
    const previousYaw=hero.group.rotation.y;hero.group.rotation.y-=sideways*dt*1.45*Math.min(1,Math.abs(carSpeed)/6)*(carSpeed<0?-1:1);
    if(!groundFootprintSupported(player,{...collisionOptions(),driving:true,heading:hero.group.rotation.y})||blocked(player,1.3))hero.group.rotation.y=previousYaw;
    facing.set(-Math.sin(hero.group.rotation.y),0,-Math.cos(hero.group.rotation.y));velocity.copy(facing).multiplyScalar(carSpeed);
  }else{const boost=keys.has('shift')||stick.length()>.93;const speed=interior?2.8:flying?(boost?75:35):boost?6.2:3.7;velocity.lerp(movement.multiplyScalar(freeCamera?0:speed),1-Math.exp(-dt*8));}
  const old=player.clone(),next=old.clone().addScaledVector(velocity,dt),bounds=world.worldBounds;
  next.x=THREE.MathUtils.clamp(next.x,bounds.minX+.5,bounds.maxX-.5);next.z=THREE.MathUtils.clamp(next.z,bounds.minZ+.5,bounds.maxZ-.5);
  if(flying){
    if(keys.has('r'))flyHeight+=dt*20;if(keys.has('q'))flyHeight-=dt*20;flyHeight=THREE.MathUtils.clamp(flyHeight,1.8,180);
    const top=surfaceHeight(next);if(top>next.y-.5)flyHeight=Math.max(flyHeight,top+2.2);next.y=THREE.MathUtils.damp(player.y,flyHeight,2,dt);
    if(blocked(next,.25)){next.x=old.x;next.z=old.z;}
  }else{
    const floor=groundHeight(next,collisionOptions());const constrained=constrainGroundMove(old,next,{...collisionOptions(),driving,heading:hero.group.rotation.y});
    if(driving&&constrained.distanceToSquared(next)>.0001){carSpeed*=.2;velocity.multiplyScalar(.2);health=Math.max(10,health-dt*8);}
    next.copy(constrained);let targetFloor=groundHeight(next,collisionOptions());
    // A hero landing on a roof stays on the roof until walking over its edge.
    const surface=surfaceHeight(next);if(player.y>surface-.15&&surface>targetFloor)targetFloor=surface;
    if(targetFloor>player.y+.5&&floor<targetFloor)targetFloor=groundHeight(next,collisionOptions());
    if(player.y>targetFloor+.04){verticalSpeed=Math.max(-55,verticalSpeed-9.81*dt);next.y=Math.max(targetFloor,player.y+verticalSpeed*dt);}else{next.y=targetFloor;verticalSpeed=0;}
  }
  player.copy(next);
  if(!driving&&velocity.length()>.15){facing.copy(velocity).normalize();const heading=Math.atan2(-facing.x,-facing.z),diff=THREE.MathUtils.euclideanModulo(heading-hero.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;hero.group.rotation.y+=diff*Math.min(1,dt*9);}
  hero.animate(elapsed,velocity.length(),flying&&!driving);
  if(driving){playerCar.position.copy(player);playerCar.rotation.y=hero.group.rotation.y+Math.PI/2;}
  flightTrail.visible=flying;flightTrail.position.copy(player).add(new THREE.Vector3(0,.35,0));flightTrail.material.opacity=.3+Math.sin(elapsed*8)*.1;
  $('health-fill').style.width=`${health}%`;$('health-fill').parentElement.parentElement.setAttribute('aria-valuenow',String(Math.round(health)));
  const mapX=THREE.MathUtils.clamp(50+player.x/14,8,92),mapY=THREE.MathUtils.clamp(50+player.z/12,8,92);$('map-player').setAttribute('transform',`translate(${mapX-50} ${mapY-52}) rotate(${-hero.group.rotation.y*180/Math.PI} 50 52)`);
  updateInteraction();followCamera(false,dt);
}
function updateShadows(){
  const p=hero.group.position;
  if(p.distanceToSquared(lastShadowPosition)>64){lastShadowPosition.copy(p);sun.position.set(p.x-45,p.y+90,p.z+35);sun.target.position.copy(p);sun.target.updateMatrixWorld();sun.shadow.needsUpdate=true;}
  if(Math.floor(elapsed*8)!==Math.floor((elapsed-.016)*8))sun.shadow.needsUpdate=true;
}
function render(now){
  if(!state.visible)return;animation=requestAnimationFrame(render);const dt=Math.min(clock.getDelta(),.045);elapsed+=dt;frameEMA=frameEMA*.96+Math.min(now-lastFrame,200)*.04;lastFrame=now;
  if(frameEMA>31)slowFrames++;else slowFrames=Math.max(0,slowFrames-2);if(slowFrames>160&&!qualityReduced){qualityReduced=true;renderer.setPixelRatio(1);composer.setPixelRatio(1);bloom.enabled=false;}
  attackCooldown=Math.max(0,attackCooldown-dt);if(keys.has(' '))fireAttack();updatePlayer(dt);updateProjectiles(dt);traffic.update(dt,elapsed,hero.group.position);interior?.update(dt);if(destruction.update(dt)){sun.shadow.needsUpdate=true;if(freeCamera)syncOverview();}
  if(!reducedMotion.matches&&!interior){if(world.materials.water.bumpMap)world.materials.water.bumpMap.offset.set(elapsed*.005,elapsed*.002);boats.forEach((b,i)=>{b.position.x=((elapsed*2+i*280)%1040)-520;b.position.y=.01+Math.sin(elapsed*1.2+i)*.035;b.rotation.z=Math.sin(elapsed*.85+i)*.015;});}
  if(elapsed>nextDetailUpdate){nextDetailUpdate=elapsed+.3;const limit=freeCamera?0:smallScreen()?180:280;for(const mesh of world.group.children)if(mesh.userData.detail)mesh.visible=!freeCamera&&mesh.userData.center.distanceToSquared(hero.group.position)<limit*limit;}
  updateShadows();controls.update(dt);if(!freeCamera){if(interior)camera.position.y=Math.min(camera.position.y,interior.floorY+2.75);camera.position.copy(cameraClearance(controls.target,camera.position,collisionOptions()));}renderer.info.reset();composer.render();
}
async function init(){
  renderer=new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,smallScreen()?1.25:1.5));renderer.setSize(innerWidth,innerHeight);renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
  scene=new THREE.Scene();scene.background=new THREE.Color('#101b29');scene.fog=new THREE.Fog('#101b29',smallScreen()?120:190,smallScreen()?500:850);camera=new THREE.PerspectiveCamera(56,innerWidth/innerHeight,.08,5000);
  controls=new OrbitControls(camera,canvas);controls.enableDamping=true;controls.dampingFactor=.065;controls.enablePan=false;controls.minDistance=1.2;controls.maxDistance=60;controls.maxPolarAngle=Math.PI*.48;controls.minPolarAngle=.15;controls.rotateSpeed=.48;controls.zoomSpeed=.6;controls.autoRotateSpeed=.25;controls.addEventListener('start',()=>{manualCameraUntil=elapsed+3;});
  scene.add(new THREE.HemisphereLight('#8da6bf','#242732',.60));
  sun=new THREE.DirectionalLight('#aec7e5',.85);sun.position.set(-45,90,35);sun.castShadow=true;sun.shadow.mapSize.set(smallScreen()?1024:2048,smallScreen()?1024:2048);sun.shadow.camera.left=-65;sun.shadow.camera.right=65;sun.shadow.camera.top=65;sun.shadow.camera.bottom=-65;sun.shadow.camera.near=1;sun.shadow.camera.far=240;sun.shadow.normalBias=.05;sun.shadow.bias=-.0002;sun.shadow.radius=3;scene.add(sun,sun.target);sun.shadow.autoUpdate=false;
  const rim=new THREE.DirectionalLight('#859fc5',.4);rim.position.set(60,45,-54);scene.add(rim);
  const loader=new THREE.TextureLoader();const names=['asphalt-texture','limestone-texture','office-facade'];const maps=await Promise.all(names.map(name=>loader.loadAsync('./assets/'+name+'.jpg')));
  maps.forEach(t=>{t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());});textures={asphalt:maps[0],limestone:maps[1],officeFacade:maps[2]};
  try{const hdr=await new HDRLoader().loadAsync('./assets/night-city-1k.hdr');hdr.mapping=THREE.EquirectangularReflectionMapping;const generator=new THREE.PMREMGenerator(renderer);const environment=generator.fromEquirectangular(hdr);scene.environment=environment.texture;scene.environmentIntensity=.025;hdr.dispose();generator.dispose();}catch(error){console.warn('Night environment unavailable',error.message);}
  world=createOpenWorld({textures});
  const windowPhoto=(column,row)=>{const map=maps[2].clone();map.repeat.set(1/6,1/7);map.offset.set(column/6,row/7);map.needsUpdate=true;return map;};
  world.materials.warmGlass.map=windowPhoto(0,6);world.materials.warmGlass.emissiveMap=world.materials.warmGlass.map;world.materials.warmGlass.emissive.set('#ffffff');world.materials.warmGlass.emissiveIntensity=.15;world.materials.warmGlass.color.set('#b2a693');
  world.materials.glass.map=windowPhoto(2,6);world.materials.glass.color.set('#8795a1');
  scene.add(world.group);outsideObjects.push(world.group);spawn.copy(world.spawn);batchStatic(world.group);for(const b of world.buildings)b.bodyCollider=colliders.find(c=>c.buildingId===b.id&&c.mass);
  const waterNormal=maps[0].clone();waterNormal.colorSpace=THREE.NoColorSpace;waterNormal.wrapS=waterNormal.wrapT=THREE.RepeatWrapping;waterNormal.repeat.set(100,14);waterNormal.needsUpdate=true;world.materials.water.bumpMap=waterNormal;world.materials.water.bumpScale=.035;
  water=new THREE.Mesh(new THREE.PlaneGeometry(1260,110),world.materials.water);water.rotation.x=-Math.PI/2;water.position.set(0,-.02,485);scene.add(water);
  destruction=createDestructionSystem(scene,staticMeshes);hero=createHero();hero.group.position.copy(spawn);hero.group.rotation.y=-Math.PI/2;facing.set(1,0,0);scene.add(hero.group);
  playerCar=optimizeMoving(createCar('#4e667d'));playerCar.scale.setScalar(4.1);playerCar.position.set(-21,.15,26.8);playerCar.rotation.y=Math.PI/2;scene.add(playerCar);
  for(const z of [-.17,.17]){const headlight=new THREE.SpotLight('#d7e9ff',18,34,.43,.65,1.3);headlight.position.set(.53,.24,z);const target=new THREE.Object3D();target.position.set(8,.03,z);playerCar.add(target);headlight.target=target;playerCar.add(headlight);}
  const heroLight=new THREE.PointLight('#acdbed',2.4,5,2);heroLight.position.set(0,1.9,1);hero.group.add(heroLight);
  traffic=createTraffic(scene,{roads:world.roads,buildings:world.buildings,bounds:world.worldBounds,bridgeAreas:world.bridgeAreas,createNPC});npcList.push(...traffic.npcs);
  for(let i=0;i<3;i++){const boat=optimizeMoving(createBoat());boat.scale.setScalar(3.5);boat.position.set(-200+i*280,0,472+i*20);scene.add(boat);boats.push(boat);outsideObjects.push(boat);}
  const flareCanvas=document.createElement('canvas');flareCanvas.width=64;flareCanvas.height=64;const ctx=flareCanvas.getContext('2d'),g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(117,232,255,1)');g.addColorStop(.2,'rgba(78,209,235,.5)');g.addColorStop(1,'rgba(57,166,200,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);
  flightTrail=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(flareCanvas),color:'#a3e9fa',transparent:true,opacity:.3,depthWrite:false,blending:THREE.AdditiveBlending}));flightTrail.scale.set(2.4,2.4,1);flightTrail.visible=false;scene.add(flightTrail);
  // Practical street lighting is attached to the actor's nearby street block.
  for(const p of [[-8,4,28],[8,4,28],[-8,4,-25],[8,4,-25]]){const light=new THREE.PointLight('#ffd3a0',70,22,2);light.position.set(...p);scene.add(light);outsideObjects.push(light);}
  composer=new EffectComposer(renderer);composer.addPass(new RenderPass(scene,camera));bloom=new UnrealBloomPass(new THREE.Vector2(innerWidth,innerHeight),.28,.45,1.15);composer.addPass(bloom);composer.addPass(new OutputPass());
  renderMap();bindControls();followCamera(true);flyingState();clock=new THREE.Clock();lastFrame=performance.now();animation=requestAnimationFrame(render);
  document.body.classList.add('loaded');$('loader').classList.add('is-loaded');setTimeout(()=>$('loader').hidden=true,800);
  window.cityExperience={getStats:()=>({drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio:renderer.getPixelRatio(),mode:interior?'interior':driving?'driving':flying?'flying':'walking',hero:hero.group.position.toArray().map(n=>Math.round(n*100)/100),camera:camera.position.toArray().map(n=>Math.round(n*100)/100),npcAlive:npcList.filter(n=>!n.dead).length,kills,destroyed:destruction.destroyedInstances.size,projectiles:projectiles.length,freeCamera,frameMS:Math.round(frameEMA),health,worldSize:[1260,1080],colliderCount:colliders.length,buildingCount:world.buildings.length,doorCount:world.doors.length,interior:interior?{buildingId:interior.buildingId,objects:interior.interactables.map(i=>({id:i.id,label:i.label,position:i.position.toArray(),state:i.state}))}:null,nearInteraction:nearInteraction?.item?.label||nearInteraction?.door?.building?.name||null,traffic:(()=>{const s=traffic.stats();return {cars:s.carCount,population:s.population,visibleNPCs:s.visibleNPCCount,timeHour:Math.round(s.timeHour*100)/100,stoppedCars:s.cars.filter(c=>c.speed<.3).length};})(),velocity:velocity.toArray().map(n=>Math.round(n*100)/100),keys:[...keys]}),getTraffic:()=>traffic.stats(),getWorld:()=>({bounds:world.worldBounds,bridges:world.bridgeAreas,water:world.waterAreas,districts:world.districts.map(d=>({id:d.id,name:d.name})),doors:world.doors.map(d=>({id:d.id,type:d.type,position:d.position.toArray(),buildingId:d.buildingId}))})};
}
function killNPC(npc,direction){
  if(npc.dead)return;npc.dead=true;npc.deathTime=elapsed;npc.knock.copy(direction).multiplyScalar(3);kills++;
}
function fireAttack(target){
  if(interior||attackCooldown>0)return;attackCooldown=.30;$('attack').classList.add('active');setTimeout(()=>$('attack').classList.remove('active'),160);
  const origin=hero.group.position.clone().add(new THREE.Vector3(0,driving?.5:1.1,0));
  let direction=facing.clone();
  if(target)direction.copy(target).sub(origin).normalize();
  else{
    let closest=null,best=7;
    for(const npc of npcList){if(npc.dead||!npc.group.visible)continue;const d=npc.group.position.distanceTo(hero.group.position);if(d<best){best=d;closest=npc;}}
    if(closest)direction.copy(closest.group.position).add(new THREE.Vector3(0,.8,0)).sub(origin).normalize();
  }
  origin.addScaledVector(direction,.6);facing.copy(direction).setY(0).normalize();
  const object=new THREE.Group();object.add(new THREE.Mesh(projectileGeometry,projectileMaterial));
  const aura=new THREE.Mesh(projectileGeometry,coreGlowMaterial);aura.scale.setScalar(2.8);object.add(aura);object.position.copy(origin);scene.add(object);
  projectiles.push({object,direction,life:1.7,previous:origin.clone()});
  if(projectiles.length>14){scene.remove(projectiles.shift().object);}
  // A close-range strike can knock down nearby civilians and break a facade.
  for(const npc of npcList)if(!npc.dead&&npc.group.visible&&npc.group.position.distanceTo(origin)<2.2)killNPC(npc,direction);
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
  for(const [id,key] of [['rise','r'],['descend','q']]){const button=$(id);button.onpointerdown=event=>{button.setPointerCapture(event.pointerId);keys.add(key);};button.onpointerup=button.onpointercancel=button.onlostpointercapture=()=>keys.delete(key);}
  $('interact').onclick=interact;$('flight-toggle').onclick=toggleFlight;$('enter-vehicle').onclick=toggleVehicle;$('attack').onclick=()=>fireAttack();
  $('auto-rotate').onclick=setFreeCamera;$('reset-view').onclick=respawn;$('zoom-in').onclick=()=>zoom(.88);$('zoom-out').onclick=()=>zoom(1.14);
  $('sound-toggle').onclick=()=>toggleSound().catch(()=>{});$('help-toggle').onclick=()=>{$('help-panel').hidden=!$('help-panel').hidden;$('help-toggle').setAttribute('aria-expanded',String(!$('help-panel').hidden));};
  window.addEventListener('keydown',event=>{
    const key=event.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright',' ','f','e','q','r','shift'].includes(key)){event.preventDefault();keys.add(key);}
    if(event.repeat)return;if(key==='f')toggleFlight();if(key==='e')interact();if(key===' ')fireAttack();if(key==='escape'){$('help-panel').hidden=true;$('help-toggle').setAttribute('aria-expanded','false');}if(key==='c')setFreeCamera();
  });window.addEventListener('keyup',event=>keys.delete(event.key.toLowerCase()));window.addEventListener('blur',()=>{keys.clear();stick.set(0,0);});
  bindCanvasSelection(canvas,attackAt,()=>{manualCameraUntil=elapsed+3;});
  const joystick=$('joystick'),knob=$('joystick-knob');let joystickPointer=null;
  const move=event=>{if(event.pointerId!==joystickPointer)return;const rect=joystick.getBoundingClientRect(),radius=rect.width*.34;let x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2;const distance=Math.hypot(x,y);if(distance>radius){x*=radius/distance;y*=radius/distance;}stick.set(x/radius,y/radius);knob.style.transform=`translate(${x}px,${y}px)`;};
  joystick.addEventListener('pointerdown',event=>{if(joystickPointer!==null)return;joystickPointer=event.pointerId;joystick.setPointerCapture(event.pointerId);move(event);});joystick.addEventListener('pointermove',move);
  const release=event=>{if(event.pointerId!==joystickPointer)return;joystickPointer=null;stick.set(0,0);knob.style.transform='translate(0,0)';};joystick.addEventListener('pointerup',release);joystick.addEventListener('pointercancel',release);joystick.addEventListener('lostpointercapture',release);
  window.addEventListener('resize',resize);document.addEventListener('visibilitychange',()=>{state.visible=!document.hidden;keys.clear();stick.set(0,0);if(state.visible){lastFrame=performance.now();clock.getDelta();if(!animation)animation=requestAnimationFrame(render);}else{cancelAnimationFrame(animation);animation=null;}if(audioGain)audioGain.gain.setTargetAtTime(state.visible&&state.sound?.14:0,audioContext.currentTime,.3);});
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(animation);$('fallback').hidden=false;});canvas.addEventListener('webglcontextrestored',()=>location.reload());
  reducedMotion.addEventListener('change',()=>{controls.autoRotate=freeCamera&&!reducedMotion.matches;});
}
function updateProjectiles(dt){
  const ray=new THREE.Raycaster();
  for(let i=projectiles.length-1;i>=0;i--){
    const p=projectiles[i];p.life-=dt;p.previous.copy(p.object.position);p.object.position.addScaledVector(p.direction,dt*32);
    let impact=false;
    for(const npc of npcList)if(!npc.dead&&npc.group.visible&&npc.group.position.clone().add(new THREE.Vector3(0,.8,0)).distanceTo(p.object.position)<.8){killNPC(npc,p.direction);impact=true;break;}
    if(!impact&&!interior){ray.set(p.previous,p.direction);ray.far=dt*32+.2;const hits=ray.intersectObjects(staticMeshes,false);const hit=hits.find(h=>h.object.userData.landmarks[h.instanceId]&&h.object.userData.landmarks[h.instanceId]!=='gardens'&&!destruction.isDestroyed(h.object,h.instanceId));if(hit){const count=destruction.destroyNear(hit.point,3.0,1.4);if(count)sun.shadow.needsUpdate=true;impact=true;}}
    if(impact||p.life<0){scene.remove(p.object);projectiles.splice(i,1);}
  }
}
init().catch(error=>{console.error('Westhaven could not initialize:',error);$('loader').hidden=true;$('fallback').hidden=false;});
