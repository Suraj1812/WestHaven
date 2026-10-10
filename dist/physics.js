import * as THREE from './vendor/three.module.js';

const removed = (box, destruction) => box.object && destruction?.isDestroyed(box.object, box.index);
const inside = (p, r, inset = 0) => p.x >= r.minX + inset && p.x <= r.maxX - inset && p.z >= r.minZ + inset && p.z <= r.maxZ - inset;
const bridgeRect = b => b.minX === undefined ? {minX:b.x-b.width/2,maxX:b.x+b.width/2,minZ:b.minZ??b.startZ??412,maxZ:b.maxZ??b.endZ??540} : b;

export function groundHeight(point, {bridges = [], floorY = .15} = {}) {
  let height = floorY;
  for (const bridge of bridges) {
    const rect = bridgeRect(bridge), start = bridge.rampStart ?? rect.minZ - 17, end = bridge.rampEnd ?? rect.minZ;
    if (point.x < rect.minX || point.x > rect.maxX || point.z < start || point.z > rect.maxZ) continue;
    height = Math.max(height, THREE.MathUtils.lerp(floorY, bridge.height ?? 1.35, THREE.MathUtils.clamp((point.z-start)/Math.max(1,end-start),0,1)));
  }
  return height;
}

export function getSurfaceHeight(point, options = {}) {
  let height = groundHeight(point, options);
  for (const box of options.colliders || []) {
    if (removed(box, options.destruction)) continue;
    if (Math.abs(point.x-box.center.x) <= Math.abs(box.scale.x)/2+.05 && Math.abs(point.z-box.center.z) <= Math.abs(box.scale.z)/2+.05) height = Math.max(height,box.center.y+Math.abs(box.scale.y)/2+.02);
  }
  return height;
}

export function blockedByBuilding(point, {colliders = [], destruction, margin = .28} = {}) {
  return colliders.some(box => !removed(box,destruction) && point.y < box.center.y+Math.abs(box.scale.y)/2-.07 && point.y+1.7 > box.center.y-Math.abs(box.scale.y)/2 && Math.abs(point.x-box.center.x)<Math.abs(box.scale.x)/2+margin && Math.abs(point.z-box.center.z)<Math.abs(box.scale.z)/2+margin);
}

export function groundFootprintSupported(point, {heading=0,driving=false,bounds={minX:-630,maxX:630,minZ:-540,maxZ:540},waterAreas=[],bridges=[]}={}) {
  const fx=-Math.sin(heading),fz=-Math.cos(heading),rx=Math.cos(heading),rz=-Math.sin(heading),length=driving?2.2:.25,width=driving?1:.25;
  const corners=[[fx*length+rx*width,fz*length+rz*width],[fx*length-rx*width,fz*length-rz*width],[-fx*length-rx*width,-fz*length-rz*width],[-fx*length+rx*width,-fz*length+rz*width]];
  const rects=bridges.map(bridgeRect),support=p=>inside(p,bounds)&&(!waterAreas.some(w=>inside(p,w))||rects.some(b=>inside(p,b)));
  const allRects=[bounds,...waterAreas,...rects],xs=allRects.flatMap(r=>[r.minX,r.maxX]),zs=allRects.flatMap(r=>[r.minZ,r.maxZ]);
  for(let i=0;i<4;i++){
    const a=corners[i],b=corners[(i+1)%4],dx=b[0]-a[0],dz=b[1]-a[1],cuts=[0,1];
    if(Math.abs(dx)>1e-9)for(const x of xs){const t=(x-point.x-a[0])/dx;if(t>0&&t<1)cuts.push(t);}
    if(Math.abs(dz)>1e-9)for(const z of zs){const t=(z-point.z-a[1])/dz;if(t>0&&t<1)cuts.push(t);}
    cuts.sort((x,y)=>x-y);
    for(let j=0;j<cuts.length;j++){const t=cuts[j];if(!support({x:point.x+a[0]+dx*t,z:point.z+a[1]+dz*t}))return false;if(j){const mid=(t+cuts[j-1])/2;if(!support({x:point.x+a[0]+dx*mid,z:point.z+a[1]+dz*mid}))return false;}}
  }
  return true;
}

// A rotated vehicle uses a complete 4.4 × 2 metre footprint; corners and edges must be on solid land.
export function constrainGroundMove(old, next, {
  colliders = [], destruction, driving = false, heading = 0,
  bounds = {minX:-630,maxX:630,minZ:-540,maxZ:540}, waterAreas = [], bridges = [],
} = {}) {
  const fx=-Math.sin(heading),fz=-Math.cos(heading),rx=Math.cos(heading),rz=-Math.sin(heading);
  const length=driving?2.2:.25,width=driving?1:.25,ex=Math.abs(fx)*length+Math.abs(rx)*width,ez=Math.abs(fz)*length+Math.abs(rz)*width;
  const corners=[[fx*length+rx*width,fz*length+rz*width],[fx*length-rx*width,fz*length-rz*width],[-fx*length-rx*width,-fz*length-rz*width],[-fx*length+rx*width,-fz*length+rz*width]];
  function valid(p) {
    if(!groundFootprintSupported(p,{heading,driving,bounds,waterAreas,bridges}))return false;
    for(const box of colliders){
      if(removed(box,destruction)||p.y>=box.center.y+Math.abs(box.scale.y)/2-.07||p.y+1.7<=box.center.y-Math.abs(box.scale.y)/2)continue;
      const bx=Math.abs(box.scale.x)/2+.04,bz=Math.abs(box.scale.z)/2+.04,dx=p.x-box.center.x,dz=p.z-box.center.z;
      if(Math.abs(dx)>=bx+ex||Math.abs(dz)>=bz+ez)continue;
      if(Math.abs(dx*fx+dz*fz)>=length+bx*Math.abs(fx)+bz*Math.abs(fz))continue;
      if(Math.abs(dx*rx+dz*rz)>=width+bx*Math.abs(rx)+bz*Math.abs(rz))continue;
      return false;
    }
    return true;
  }
  const desired=new THREE.Vector3(THREE.MathUtils.clamp(next.x,bounds.minX+ex,bounds.maxX-ex),next.y,THREE.MathUtils.clamp(next.z,bounds.minZ+ez,bounds.maxZ-ez));
  if(valid(desired))return desired;
  const origin=new THREE.Vector3(old.x,next.y,old.z),stopped=origin.clone();
  if(valid(origin)){
    let low=0,high=1;for(let i=0;i<12;i++){const t=(low+high)/2;stopped.lerpVectors(origin,desired,t);if(valid(stopped))low=t;else high=t;}stopped.lerpVectors(origin,desired,low);
  }
  const slides=[new THREE.Vector3(desired.x,next.y,stopped.z),new THREE.Vector3(stopped.x,next.y,desired.z)].filter(valid).sort((a,b)=>b.distanceToSquared(origin)-a.distanceToSquared(origin));
  return slides[0]||stopped;
}

// Shorten the follow camera before it passes through a solid wall or facade.
export function cameraClearance(target, desired, {colliders=[],destruction,margin=.2}={}) {
  const delta=desired.clone().sub(target),length=delta.length();if(length<.01)return desired.clone();
  const ray=new THREE.Ray(target,delta.divideScalar(length)),hit=new THREE.Vector3();let nearest=length;
  for(const box of colliders){
    if(removed(box,destruction))continue;
    if(Math.abs(box.center.x-target.x)>length+Math.abs(box.scale.x)/2+margin || Math.abs(box.center.z-target.z)>length+Math.abs(box.scale.z)/2+margin)continue;
    const half=box.scale.clone().multiplyScalar(.5).addScalar(margin),bounds=new THREE.Box3(box.center.clone().sub(half),box.center.clone().add(half));
    // Furniture overlapping the target must not trap the camera inside the actor.
    if(bounds.containsPoint(target))continue;
    if(ray.intersectBox(bounds,hit)){const distance=hit.distanceTo(target);if(distance<nearest)nearest=Math.max(.65,distance-.15);}
  }
  return target.clone().addScaledVector(ray.direction,nearest);
}
