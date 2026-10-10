import * as THREE from './vendor/three.module.js';

const geoCache = new Map(), matCache = new Map(), textureCache = new Map();
const geo = (key,make) => { if(!geoCache.has(key))geoCache.set(key,make());return geoCache.get(key); };
const boxGeo = geo('box',()=>new THREE.BoxGeometry(1,1,1));
const cylinderGeo = geo('cylinder',()=>new THREE.CylinderGeometry(1,1,1,16));
const ballGeo = geo('ball',()=>new THREE.SphereGeometry(1,12,8));
const leafGeo = geo('leaf',()=>new THREE.IcosahedronGeometry(1,1));
function texture(kind) {
  if(textureCache.has(kind))return textureCache.get(kind);
  if(typeof document==='undefined')return null;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;
  const c=canvas.getContext('2d');if(!c)return null;
  c.fillStyle=kind==='wood'?'#b8a18c':kind==='screen'?'#102c43':'#d9d5c9';c.fillRect(0,0,256,256);
  if(kind==='wood') {
    for(let i=0;i<8;i++){c.fillStyle=i%2?'rgba(65,40,23,.08)':'rgba(247,230,205,.10)';c.fillRect(i*32,0,31,256);c.fillStyle='rgba(64,43,31,.25)';c.fillRect(i*32,0,1,256);}
    for(let i=0;i<130;i++){c.strokeStyle=`rgba(70,46,30,${.025+Math.random()*.045})`;c.beginPath();const x=Math.random()*256;c.moveTo(x,0);c.bezierCurveTo(x+3,80,x-3,180,x+2,256);c.stroke();}
  } else if(kind==='screen') {
    const g=c.createLinearGradient(0,0,0,256);g.addColorStop(0,'#234459');g.addColorStop(.65,'#749488');g.addColorStop(1,'#192b37');c.fillStyle=g;c.fillRect(0,0,256,256);
    c.fillStyle='#d0c9aa';c.beginPath();c.arc(191,64,24,0,Math.PI*2);c.fill();
    for(let i=0;i<16;i++){const h=30+Math.random()*100;c.fillStyle=i%2?'#253a43':'#334d55';c.fillRect(i*17,200-h,15,h);for(let y=205-h;y<198;y+=10){c.fillStyle='#aeb19a';c.fillRect(i*17+4,y,3,4);}}
    c.fillStyle='#345b63';c.fillRect(0,200,256,56);
  } else {
    for(let i=0;i<7000;i++){const value=Math.random()>.5?255:65;c.fillStyle=`rgba(${value},${value},${value},.045)`;c.fillRect(Math.random()*256,Math.random()*256,1+Math.random()*2,1+Math.random()*2);}
    if(kind==='tile'){c.strokeStyle='rgba(79,77,68,.20)';c.lineWidth=2;for(let i=0;i<5;i++){c.beginPath();c.moveTo(i*64,0);c.lineTo(i*64,256);c.moveTo(0,i*64);c.lineTo(256,i*64);c.stroke();}}
  }
  const map=new THREE.CanvasTexture(canvas);map.colorSpace=THREE.SRGBColorSpace;map.wrapS=map.wrapT=THREE.RepeatWrapping;map.anisotropy=4;textureCache.set(kind,map);return map;
}
function mat(color,roughness=.75,metalness=0,map=null,extra={}) {
  const key=JSON.stringify([color,roughness,metalness,map?.uuid,extra]);
  if(!matCache.has(key))matCache.set(key,new THREE.MeshStandardMaterial({color,roughness,metalness,...(map?{map}:{}),...extra}));
  return matCache.get(key);
}
const randomFor = seed => { let n=typeof seed==='number'?seed: Array.from(String(seed)).reduce((a,c)=>(Math.imul(a,31)+c.charCodeAt(0))>>>0,421);return ()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;}; };

function add(parent,geometry,material,x,y,z,sx=1,sy=1,sz=1) {
  const node=new THREE.Mesh(geometry,material);node.position.set(x,y,z);node.scale.set(sx,sy,sz);node.castShadow=true;node.receiveShadow=true;parent.add(node);return node;
}
const b=(p,w,h,d,x,y,z,m)=>add(p,boxGeo,m,x,y,z,w,h,d);
const cy=(p,r,h,x,y,z,m)=>add(p,cylinderGeo,m,x,y,z,r,h,r);
const sphere=(p,x,y,z,sx,sy,sz,m)=>add(p,ballGeo,m,x,y,z,sx,sy,sz);

function mergeStatic(group,disposables) {
  group.updateMatrixWorld(true);
  const inverse=group.matrixWorld.clone().invert(),batches=new Map();
  group.traverse(node=>{
    if(!node.isMesh)return;
    const g=node.geometry.index?node.geometry.toNonIndexed():node.geometry.clone();
    g.applyMatrix4(inverse.clone().multiply(node.matrixWorld));
    if(!batches.has(node.material.uuid))batches.set(node.material.uuid,{material:node.material,positions:[],normals:[],uvs:[],castShadow:false});
    const batch=batches.get(node.material.uuid);
    batch.castShadow ||= node.castShadow;
    batch.positions.push(...g.attributes.position.array);batch.normals.push(...g.attributes.normal.array);
    if(g.attributes.uv)batch.uvs.push(...g.attributes.uv.array);else batch.uvs.push(...new Array(g.attributes.position.count*2).fill(0));
    g.dispose();
  });
  group.clear();
  for(const batch of batches.values()) {
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(batch.positions,3));g.setAttribute('normal',new THREE.Float32BufferAttribute(batch.normals,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(batch.uvs,2));g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,batch.material);mesh.castShadow=batch.castShadow;mesh.receiveShadow=true;group.add(mesh);disposables.push(g);
  }
}

export function createInterior(building,{textures}={}) {
  const origin=building.position?.clone?.()||new THREE.Vector3(building.position?.x||0,0,building.position?.z||0);
  origin.y=0;
  const width=Math.max(8,Number(building.width)||12),depth=Math.max(10,Number(building.depth)||15),halfW=width/2,halfD=depth/2;
  const front=building.front===-1||building.doorFacing?.z<0?-1:1;
  const floorY=.12, wallHeight=2.9, hallWidth=Math.min(2.4,Math.max(1.8,width*.14)),hall=hallWidth/2;
  const random=randomFor(building.seed??building.id??37), variant=Math.floor(random()*4);
  const group=new THREE.Group();group.name=`Interior · ${building.name||building.type||'Residence'}`;group.position.copy(origin);group.rotation.y=front===-1?Math.PI:0;
  const staticGroup=new THREE.Group(),dynamicGroup=new THREE.Group(),wallsGroup=new THREE.Group();
  staticGroup.position.y=dynamicGroup.position.y=wallsGroup.position.y=floorY;group.add(staticGroup,wallsGroup,dynamicGroup);
  const colliders=[],interactables=[],updates=[],disposables=[],uniqueMaterials=[];
  const walls=[];group.userData.interiorWalls=walls;group.userData.floorY=floorY;
  const woodMap=textures?.wood?.isTexture?textures.wood:texture('wood');
  const stoneMap=textures?.limestone?.isTexture?textures.limestone:texture('stone');
  const wood=mat(['#9b7d5c','#947253','#ad8c67','#807363'][variant],.70,0,woodMap);
  const flooring=mat(['#af9a7d','#93826d','#ab977f','#958c79'][variant],.88,0,woodMap);
  const stone=mat('#d4d0c5',.71,.01,stoneMap),white=mat('#e6e3da',.59,.02),wallMaterial=mat('#d0cec3',.88,0,stoneMap);
  const metal=mat('#adb7b4',.28,.85),dark=mat('#263035',.59,.14),black=mat('#141b1f',.53,.08);
  const fabric=mat(['#707a78','#85776c','#677b7d','#858178'][variant],.97,0,texture('cloth'));
  const bedding=mat('#d4d3c7',.95),pillow=mat('#bbb6a5',.98),accent=mat(['#806d5b','#5b7371','#9b816e','#6b737e'][variant],.93);
  const green=mat('#627a5a',.87),soil=mat('#564b3b',1),glass=mat('#9db8b6',.18,.08,null,{transparent:true,opacity:.30,depthWrite:false});
  const glow=mat('#f4ddaf',.5,0,null,{emissive:'#f2cf93',emissiveIntensity:.85});
  const toWorld=(x,y,z)=>new THREE.Vector3(origin.x+front*x,y+floorY,origin.z+front*z);
  const collider=(x,y,z,w,h,d,object)=>{const item={center:toWorld(x,y,z),scale:new THREE.Vector3(w,h,d),...(object?{object}:{})};colliders.push(item);return item;};
  function interaction(label,x,y,z,action,type='use',radius=1.8) {
    const item={id:`${building.id||'building'}:interaction:${interactables.length}`,label,position:toWorld(x,y,z),radius,type,state:{},action:null};
    item.action=()=>action(item);interactables.push(item);return item;
  }
  function wall(w,d,x,z,h=wallHeight,y=h/2) {
    const wm=wallMaterial.clone();uniqueMaterials.push(wm);
    const node=b(wallsGroup,w,h,d,x,y,z,wm);node.userData.interiorWall=true;walls.push(node);collider(x,y,z,w,h,d,node);return node;
  }
  // Room doors are real openings; lintels remain above the human collision volume.
  function partition(axis,coordinate,start,end,openings=[]) {
    const spans=openings.map(o=>[Math.max(start,o.center-o.width/2),Math.min(end,o.center+o.width/2)]).sort((a,b)=>a[0]-b[0]);let cursor=start;
    for(const [a,z] of spans) {
      if(a>cursor){const len=a-cursor,mid=(a+cursor)/2;axis==='x'?wall(len,.14,mid,coordinate):wall(.14,len,coordinate,mid);}
      const len=z-a,mid=(a+z)/2;
      axis==='x'?wall(len,.14,mid,coordinate,.68,2.56):wall(.14,len,coordinate,mid,.68,2.56);
      if(axis==='x'){for(const v of [a,z])b(staticGroup,.055,2.18,.20,v,1.09,coordinate,wood);b(staticGroup,len+.08,.06,.20,mid,2.18,coordinate,wood);}
      else {for(const v of [a,z])b(staticGroup,.20,2.18,.055,coordinate,1.09,v,wood);b(staticGroup,.20,.06,len+.08,coordinate,2.18,mid,wood);}
      cursor=Math.max(cursor,z);
    }
    if(end>cursor){const len=end-cursor,mid=(end+cursor)/2;axis==='x'?wall(len,.14,mid,coordinate):wall(.14,len,coordinate,mid);}
  }
  const door=building.door?.clone?.()||new THREE.Vector3(origin.x,.15,origin.z+front*halfD);
  const doorX=THREE.MathUtils.clamp((door.x-origin.x)*front,-halfW+1,halfW-1);
  b(staticGroup,width,.12,depth,0,-.06,0,flooring);
  const ceiling=b(staticGroup,width+.18,.10,depth+.18,0,2.95,0,mat('#deddd4',.96));
  ceiling.name='Warm plaster ceiling';ceiling.castShadow=false;
  collider(0,2.95,0,width+.18,.10,depth+.18);
  group.userData.hasCeiling=true;
  partition('x',halfD,-halfW,halfW,[{center:doorX,width:1.55}]);
  wall(width,.18,0,-halfD);wall(.18,depth,-halfW,0);wall(.18,depth,halfW,0);
  // Low skirting and tall window recesses make the room feel finished.
  for(const x of [-halfW+.11,halfW-.11])b(staticGroup,.04,.13,depth-.3,x,.065,0,wood);
  b(staticGroup,width-.3,.13,.04,0,.065,-halfD+.11,wood);
  for(const x of [-halfW+.098,halfW-.098])for(const z of [-depth*.27,depth*.27]) {
    b(staticGroup,.035,1.28,1.7,x,1.69,z,dark);b(staticGroup,.045,1.14,1.56,x+(x<0?.025:-.025),1.69,z,glass);
    b(staticGroup,.16,.07,1.84,x,1.035,z,stone);b(staticGroup,.025,1.18,.04,x+(x<0?.049:-.049),1.69,z,metal);
  }
  const rooms={
    lf:{minX:-halfW+.15,maxX:-hall-.08,minZ:.08,maxZ:halfD-.16},
    rf:{minX:hall+.08,maxX:halfW-.15,minZ:.08,maxZ:halfD-.16},
    lb:{minX:-halfW+.15,maxX:-hall-.08,minZ:-halfD+.16,maxZ:-.08},
    rb:{minX:hall+.08,maxX:halfW-.15,minZ:-halfD+.16,maxZ:-.08},
  };
  for(const r of Object.values(rooms)){r.x=(r.minX+r.maxX)/2;r.z=(r.minZ+r.maxZ)/2;r.width=r.maxX-r.minX;r.depth=r.maxZ-r.minZ;}
  const type=String(building.type||'house').toLowerCase(),residential=['house','home','townhouse','apartment','residence'].includes(type);
  const openDining=['restaurant','cafe','store','library','school'].includes(type);
  for(const x of [-hall,hall]) partition('z',x,-halfD+.15,openDining?-.06:halfD-.15,
    [{center:-depth*.25,width:1.45},...(!openDining?[{center:depth*.25,width:1.45}]:[])]);
  partition('x',0,-halfW+.15,-hall-.08);partition('x',0,hall+.08,halfW-.15);
  function furniture(name,x,z,rotation,build,w,h,d) {
    const p=new THREE.Group();p.name=name;p.position.set(x,0,z);p.rotation.y=rotation||0;staticGroup.add(p);build(p);
    if(w&&h&&d){const c=Math.abs(Math.cos(rotation||0)),s=Math.abs(Math.sin(rotation||0));collider(x,h/2,z,w*c+d*s,h,w*s+d*c);}
    return p;
  }
  function plant(x,z,size=1) {
    furniture('Indoor plant',x,z,0,p=>{cy(p,.14,.24,0,.12,0,stone);cy(p,.122,.012,0,.243,0,soil);cy(p,.012,.47,0,.45,0,wood);for(let i=0;i<5;i++){const a=i*2.4;add(p,leafGeo,green,Math.cos(a)*.10,.52+i*.038,Math.sin(a)*.10,.13,.08,.09);}},.27,.7,.27).scale.setScalar(size);
  }
  function chair(x,z,rotation=0) {
    furniture('Dining chair',x,z,rotation,p=>{b(p,.48,.07,.49,0,.46,0,fabric);b(p,.46,.43,.055,0,.71,.22,wood);for(const a of [-.18,.18])for(const c of [-.18,.18])b(p,.042,.43,.042,a,.215,c,wood);},.48,.90,.49);
  }
  function table(x,z,w=1.35,d=.85,chairs=true) {
    furniture('Dining table',x,z,0,p=>{b(p,w,.06,d,0,.765,0,wood);for(const a of [-w*.40,w*.40])for(const c of [-d*.34,d*.34])b(p,.055,.73,.055,a,.365,c,wood);cy(p,.052,.11,0,.85,0,white);sphere(p,0,.93,0,.065,.06,.065,green);},w,.80,d);
    if(chairs){chair(x,z+d/2+.42);chair(x,z-d/2-.42,Math.PI);if(w>1.6){chair(x-w/2-.36,z,-Math.PI/2);chair(x+w/2+.36,z,Math.PI/2);}}
  }
  function lamp(x,z) {
    furniture('Floor lamp',x,z,0,p=>{cy(p,.15,.035,0,.018,0,dark);cy(p,.018,1.38,0,.72,0,metal);const shade=add(p,geo('shade',()=>new THREE.ConeGeometry(1,1,20,1,true)),white,0,1.43,0,.19,.24,.19);shade.rotation.x=Math.PI;cy(p,.09,.02,0,1.32,0,glow);});
  }
  function living(r) {
    const sofaW=Math.min(2.5,r.width-.65),sofaZ=r.maxZ-1.05;
    furniture('Upholstered sofa',r.x,sofaZ,0,p=>{b(p,sofaW,.29,.91,0,.28,0,fabric);b(p,sofaW,.51,.20,0,.65,.37,fabric);for(const x of [-sofaW/2+.1,sofaW/2-.1]){b(p,.20,.37,.90,x,.48,0,fabric);cy(p,.026,.14,x,.07,.28,dark);cy(p,.026,.14,x,.07,-.28,dark);}for(let i=0;i<3;i++)b(p,(sofaW-.45)/3,.13,.68,(i-1)*(sofaW-.45)/3,.47,-.035,pillow);for(const x of [-sofaW*.28,sofaW*.28])b(p,.37,.32,.15,x,.66,.22,accent);},sofaW,.92,.94);
    furniture('Coffee table',r.x,sofaZ-1.38,0,p=>{b(p,1.15,.055,.62,0,.40,0,wood);for(const x of [-.44,.44])b(p,.06,.37,.40,x,.18,0,dark);b(p,.23,.025,.17,-.22,.444,0,accent);cy(p,.043,.05,.22,.47,0,white);},1.15,.45,.62);
    const tvZ=r.minZ+.43;
    furniture('Media cabinet',r.x,tvZ,0,p=>{b(p,1.75,.48,.40,0,.29,0,wood);for(const x of [-.45,.45])b(p,.74,.36,.023,x,.31,.212,stone);for(const x of [-.48,.48])b(p,.11,.013,.025,x,.31,.23,metal);},1.75,.54,.44);
    const screenMat=new THREE.MeshStandardMaterial({color:'#10161a',roughness:.28,metalness:.2,map:texture('screen'),emissive:'#000000',emissiveMap:texture('screen')});uniqueMaterials.push(screenMat);
    b(dynamicGroup,1.40,.80,.065,r.x,1.19,tvZ,black);const screen=b(dynamicGroup,1.32,.71,.012,r.x,1.20,tvZ+.043,screenMat);
    const tv=interaction('Switch TV on',r.x,1,tvZ+.65,item=>{item.state.on=!item.state.on;screenMat.color.set(item.state.on?'#ffffff':'#10161a');screenMat.emissive.set(item.state.on?'#c5e3ec':'#000000');screenMat.emissiveIntensity=item.state.on?.7:0;item.label=item.state.on?'Switch TV off':'Switch TV on';return {type:'tv',on:item.state.on};},'tv',2.1);
    tv.state.on=false;screen.userData.interactable=tv.id;
    tv.applyState=()=>{screenMat.color.set(tv.state.on?'#ffffff':'#10161a');screenMat.emissive.set(tv.state.on?'#c5e3ec':'#000000');screenMat.emissiveIntensity=tv.state.on?.7:0;tv.label=tv.state.on?'Switch TV off':'Switch TV on';};
    lamp(r.minX+.48,sofaZ-.4);plant(r.maxX-.35,r.maxZ-.50,.85);
    b(staticGroup,Math.min(2.6,r.width-.4),.012,2.3,r.x,.012,sofaZ-.8,mat('#8a897b',.99));
  }
  function faucet(x,z,label='Turn faucet on') {
    cy(staticGroup,.014,.22,x,1.09,z+.12,metal);
    const arc=add(staticGroup,geo('faucet-arc',()=>new THREE.TorusGeometry(.10,.014,6,14,Math.PI)),metal,x,1.20,z+.02);arc.rotation.y=Math.PI/2;
    const wm=new THREE.MeshStandardMaterial({color:'#8fc2cf',transparent:true,opacity:.44,roughness:.12,metalness:.1});uniqueMaterials.push(wm);
    const flow=cy(dynamicGroup,.006,.20,x,1.08,z-.08,wm);flow.visible=false;flow.name='Faucet water';
    const item=interaction(label,x,.9,z,entry=>{entry.state.on=!entry.state.on;flow.visible=entry.state.on;entry.label=entry.state.on?'Turn faucet off':label;return{type:'faucet',on:entry.state.on};},'faucet');item.state.on=false;
    item.applyState=()=>{flow.visible=!!item.state.on;item.label=item.state.on?'Turn faucet off':label;};
  }
  function kitchen(r) {
    const cabinetW=Math.max(1.4,Math.min(3,r.width-1.1)),cx=r.minX+cabinetW/2+.10,cz=r.maxZ-.38;
    furniture('Kitchen cabinets',cx,cz,0,p=>{b(p,cabinetW,.84,.66,0,.44,0,wood);b(p,cabinetW+.06,.055,.72,0,.895,0,stone);for(let i=0;i<3;i++){const x=(i-1)*cabinetW/3;b(p,cabinetW/3-.035,.71,.03,x,.45,-.349,white);b(p,.14,.014,.024,x,.74,-.371,metal);}b(p,cabinetW*.72,.72,.32,-.05,1.78,.12,wood);for(const x of [-cabinetW*.18,cabinetW*.18])b(p,cabinetW*.34,.66,.025,x,1.78,-.05,white);},cabinetW,.94,.72);
    const sx=cx-cabinetW*.22,sz=cz-.02;
    b(staticGroup,.52,.018,.37,sx,.933,sz,dark);for(const x of [-.275,.275])b(staticGroup,.045,.025,.43,sx+x,.947,sz,metal);for(const z of [-.20,.20])b(staticGroup,.59,.025,.03,sx,.947,sz+z,metal);faucet(sx,sz);
    const stoveX=cx+cabinetW*.24;b(staticGroup,.49,.025,.47,stoveX,.937,cz,black);for(const x of [-.12,.12])for(const z of [-.12,.12])cy(staticGroup,.075,.008,stoveX+x,.956,cz+z,metal);
    const fridgeX=r.maxX-.48,fridgeZ=r.maxZ-.52;
    furniture('Refrigerator',fridgeX,fridgeZ,0,p=>{b(p,.76,1.84,.055,0,.94,.34,white);for(const x of [-.36,.36])b(p,.044,1.84,.72,x,.94,0,white);b(p,.76,.05,.72,0,1.88,0,white);b(p,.76,.05,.72,0,.045,0,white);for(const y of [.45,.90,1.32])b(p,.67,.018,.60,0,y,-.02,white);for(const x of [-.19,.17]){cy(p,.044,.14,x,.98,0,accent);b(p,.12,.16,.12,x,.55,.07,green);}},.79,1.92,.76);
    const hinge=new THREE.Group();hinge.name='Refrigerator hinge';hinge.position.set(fridgeX-.37,0,fridgeZ-.37);dynamicGroup.add(hinge);b(hinge,.74,1.80,.055,.37,.94,0,metal);b(hinge,.021,.46,.025,.655,1.03,-.042,dark);
    let target=0;const fridge=interaction('Open refrigerator',fridgeX,.95,fridgeZ-.65,item=>{item.state.open=!item.state.open;target=item.state.open?1.5:0;item.label=item.state.open?'Close refrigerator':'Open refrigerator';return{type:'fridge',open:item.state.open};},'fridge');fridge.state.open=false;updates.push(dt=>hinge.rotation.y=THREE.MathUtils.damp(hinge.rotation.y,target,8,dt));
    fridge.applyState=(snap=false)=>{target=fridge.state.open?1.5:0;if(snap)hinge.rotation.y=target;fridge.label=fridge.state.open?'Close refrigerator':'Open refrigerator';};
    const iz=r.z-.18;
    furniture('Kitchen island',r.x,iz,0,p=>{b(p,1.52,.83,.74,0,.43,0,wood);b(p,1.66,.055,.89,0,.885,0,stone);cy(p,.12,.04,.34,.934,0,white);sphere(p,.33,.985,0,.048,.042,.048,accent);},1.66,.94,.89);
    chair(r.x-.47,iz-.86,Math.PI);chair(r.x+.47,iz-.86,Math.PI);
  }
  function bedroom(r) {
    const x=r.x+(random()-.5)*Math.min(.35,r.width-3),z=r.minZ+2.15;
    furniture('Double bed',x,z,Math.PI,p=>{b(p,1.60,.27,2.10,0,.215,0,wood);b(p,1.52,.22,2.02,0,.46,0,bedding);b(p,1.53,.065,1.31,0,.60,-.31,accent);b(p,1.66,.91,.11,0,.69,1.05,wood);for(const a of [-.39,.39])b(p,.60,.10,.36,a,.615,.68,pillow);},1.66,1.15,2.2);
    const rest=interaction('Rest on bed',x,.6,z,item=>{item.state.rested=true;return{type:'rest',position:toWorld(x,0,z-.9),duration:1.5};},'rest',1.9);
    rest.state.rested=false;
    furniture('Bedside table',Math.min(r.maxX-.36,x+1.15),z-.68,0,p=>{b(p,.52,.48,.48,0,.24,0,wood);b(p,.42,.20,.025,0,.25,-.253,white);cy(p,.05,.12,0,.55,0,metal);sphere(p,0,.69,0,.13,.115,.13,glow);},.52,.54,.48);
    const wardrobeW=Math.min(1.7,r.width-.35);
    furniture('Wardrobe',r.x,r.maxZ-.39,0,p=>{b(p,wardrobeW,2.07,.59,0,1.035,0,wood);for(const a of [-wardrobeW*.25,wardrobeW*.25]){b(p,wardrobeW*.48,1.99,.024,a,1.035,-.31,white);b(p,.014,.22,.025,a*.25,1.09,-.333,metal);}},wardrobeW,2.07,.65);
    plant(r.minX+.38,r.maxZ-.45,.78);
  }
  function bathroom(r) {
    b(staticGroup,r.width,.022,r.depth,r.x,.015,r.z,mat('#bdc4be',.51,.02,texture('tile')));
    const sx=r.maxX-.74,sz=r.minZ+.88;
    furniture('Walk-in shower',sx,sz,0,p=>{b(p,1.15,.07,1.22,0,.04,0,white);b(p,.015,1.98,1.14,.55,1.055,0,glass);b(p,1.06,1.98,.015,0,1.055,.56,glass);for(const x of [-.55,.55])b(p,.023,2.08,.023,x,1.04,.56,metal);b(p,.025,1.54,.025,0,1.31,.52,metal);b(p,.023,.023,.40,0,2.08,.33,metal);cy(p,.09,.020,0,2.05,.12,metal);});
    const tx=r.minX+.70,tz=r.minZ+.90;
    furniture('Toilet',tx,tz,Math.PI,p=>{sphere(p,0,.21,0,.20,.22,.26,white);sphere(p,0,.40,-.03,.23,.09,.30,white);b(p,.42,.46,.16,0,.54,.23,white);b(p,.46,.04,.19,0,.79,.23,white);sphere(p,0,.462,-.066,.15,.018,.20,dark);},.49,.82,.64);
    const vx=r.maxX-.49,vz=r.maxZ-.75;
    furniture('Bathroom vanity',vx,vz,0,p=>{b(p,.75,.77,.52,0,.40,0,wood);b(p,.82,.055,.59,0,.83,0,stone);sphere(p,0,.897,-.01,.26,.048,.19,white);sphere(p,0,.929,-.01,.20,.012,.14,dark);b(p,.63,.84,.018,0,1.43,.27,metal);b(p,.58,.79,.012,0,1.43,.256,glass);},.85,.91,.63);
    faucet(vx,vz,'Turn bathroom faucet on');
    if(r.width>3.6&&r.depth>5.3){const bx=r.maxX-.70,bz=r.z+.1;furniture('Bathtub',bx,bz,0,p=>{b(p,.90,.52,1.90,0,.26,0,white);b(p,.66,.028,1.65,0,.536,0,mat('#758f90',.14,.2));for(const a of [-.39,.39])b(p,.10,.08,1.92,a,.56,0,white);for(const a of [-.91,.91])b(p,.80,.08,.10,0,.56,a,white);},.94,.62,1.94);}
    const water=add(dynamicGroup,geo('shower-water',()=>new THREE.CylinderGeometry(.035,.11,1.45,7,1,true)),mat('#9abcc5',.22,.1,null,{transparent:true,opacity:.22,depthWrite:false}),sx,1.27,sz+.12);water.visible=false;water.name='Shower water';
    const shower=interaction('Start shower',sx,.9,sz,item=>{item.state.on=!item.state.on;water.visible=item.state.on;item.label=item.state.on?'Stop shower':'Start shower';return{type:'shower',on:item.state.on};},'shower',1.5);
    shower.state.on=false;shower.applyState=()=>{water.visible=!!shower.state.on;shower.label=shower.state.on?'Stop shower':'Start shower';};
  }
  function roomDoor(x,z,side) {
    const pivot=new THREE.Group();pivot.name='Room door hinge';pivot.position.set(x,0,z-.69);dynamicGroup.add(pivot);
    const panel=b(pivot,.045,2.10,1.38,0,1.05,.69,wood);sphere(pivot,-side*.04,1.02,1.23,.025,.025,.025,metal);
    let target=side*Math.PI/2;pivot.rotation.y=target;
    const doorCollider=collider(x,1.05,z,.045,2.1,1.38,panel);
    const item=interaction('Close room door',x+side*.50,1,z,entry=>{entry.state.open=!entry.state.open;target=entry.state.open?side*Math.PI/2:0;entry.label=entry.state.open?'Close room door':'Open room door';return{type:'door',open:entry.state.open};},'door',1.5);item.state.open=true;
    const updateDoor=dt=>{pivot.rotation.y=THREE.MathUtils.damp(pivot.rotation.y,target,10,dt);const a=pivot.rotation.y,s=Math.sin(a),c=Math.cos(a);doorCollider.center.copy(toWorld(x+s*.69,1.05,z-.69+c*.69));doorCollider.scale.set(Math.abs(c)*.045+Math.abs(s)*1.38,2.1,Math.abs(s)*.045+Math.abs(c)*1.38);};
    updates.push(updateDoor);updateDoor(0);
    item.applyState=(snap=false)=>{target=item.state.open?side*Math.PI/2:0;if(snap)pivot.rotation.y=target;item.label=item.state.open?'Close room door':'Open room door';updateDoor(0);};
  }
  function desk(x,z,medical=false) {
    furniture(medical?'Clinical desk':'Workstation',x,z,0,p=>{b(p,1.42,.055,.72,0,.755,0,medical?white:wood);for(const a of [-.57,.57])b(p,.045,.72,.51,a,.36,0,metal);b(p,.56,.34,.035,0,1.03,.18,black);b(p,.49,.27,.014,0,1.03,.156,mat('#527477',.38,.1,null,{emissive:'#243c41',emissiveIntensity:.18}));b(p,.04,.18,.04,0,.84,.18,dark);b(p,.30,.024,.10,0,.80,-.16,black);b(p,.19,.018,.14,-.40,.80,-.12,white);},1.42,1.23,.75);
    chair(x,z-.64,Math.PI);
  }
  function gym(r,weights=false) {
    if(weights) {
      furniture('Weight bench',r.x,r.z,0,p=>{b(p,.42,.085,1.12,0,.49,0,black);for(const z of [-.38,.38]){b(p,.08,.46,.42,0,.23,z,metal);}for(const x of [-.48,.48]){b(p,.06,1.3,.06,x,.65,.55,metal);const disc=cy(p,.19,.06,x,1.29,.55,dark);disc.rotation.z=Math.PI/2;}const bar=cy(p,.018,1.30,0,1.29,.55,metal);bar.rotation.z=Math.PI/2;},1.4,1.53,1.16);
      for(let i=0;i<3;i++){const x=r.minX+.6+i*.58;furniture('Dumbbells',x,r.maxZ-.53,0,p=>{b(p,.5,.88,.44,0,.44,0,metal);for(const y of [.55,.91]){const handle=cy(p,.018,.29,0,y,0,metal);handle.rotation.z=Math.PI/2;for(const a of [-.14,.14]){const end=cy(p,.075,.08,a,y,0,dark);end.rotation.z=Math.PI/2;}}});}
    } else for(let i=0;i<Math.min(3,Math.floor(r.width/1.25));i++){
      const x=r.minX+.68+i*1.25,z=r.z;
      furniture('Treadmill',x,z,0,p=>{b(p,.87,.18,1.75,0,.12,0,metal);b(p,.69,.025,1.35,0,.225,-.08,black);for(const a of [-.38,.38]){b(p,.035,1.1,.035,a,.73,.62,metal);b(p,.035,.035,.71,a,1.05,.28,metal);}b(p,.77,.11,.34,0,1.25,.61,dark);b(p,.42,.04,.21,0,1.316,.56,mat('#5d979a',.3,.1,null,{emissive:'#335f63',emissiveIntensity:.3}));},.94,1.4,1.84);
      const treadmill=interaction('Use treadmill',x,.8,z-.94,item=>{item.state.running=!item.state.running;item.label=item.state.running?'Stop treadmill':'Use treadmill';return{type:'exercise',active:item.state.running};},'exercise',1.5);
      treadmill.state.running=false;treadmill.applyState=()=>{treadmill.label=treadmill.state.running?'Stop treadmill':'Use treadmill';};
    }
  }
  function hospital(r) {
    for(let i=0;i<Math.min(2,Math.floor(r.width/2.7));i++) {
      const x=r.minX+1.2+i*2.65,z=r.z;
      furniture('Hospital bed',x,z,0,p=>{b(p,1.10,.15,2.05,0,.49,0,metal);b(p,1.02,.17,1.95,0,.65,0,bedding);b(p,.72,.09,.35,0,.78,.64,white);for(const a of [-.53,.53]){b(p,.025,.22,1.50,a,.79,0,metal);for(const q of [-.75,.75])cy(p,.025,.55,a,.28,q,metal);}b(p,1.10,.53,.04,0,.67,.99,white);},1.18,1.03,2.13);
      furniture('Patient monitor',x+.83,z+.30,0,p=>{b(p,.40,.28,.06,0,1.12,0,dark);b(p,.34,.22,.01,0,1.12,-.036,mat('#457a63',.35,.1,null,{emissive:'#275a43',emissiveIntensity:.3}));cy(p,.018,1.03,0,.52,0,metal);b(p,.33,.04,.30,0,.06,0,metal);});
    }
  }
  function shelves(r,books=true) {
    const count=Math.min(3,Math.max(1,Math.floor(r.width/2)));
    for(let i=0;i<count;i++) {
      const x=r.minX+.85+i*1.65,z=r.maxZ-.40;
      furniture(books?'Bookshelves':'Shop shelving',x,z,0,p=>{for(const a of [-.65,.65])b(p,.045,2.1,.34,a,1.05,0,wood);for(const y of [.08,.53,1.03,1.53,2.05])b(p,1.35,.045,.36,0,y,0,wood);for(let j=0;j<12;j++){const a=-.54+(j%6)*.18,y=.68+Math.floor(j/6)*.5;b(p,.11,books?.29:.22,.20,a,y,-.01,j%3===0?accent:j%3===1?green:stone);}},1.43,2.1,.42);
    }
  }
  if(residential) {
    const livingRoom=variant&1?rooms.lb:rooms.lf,bedRoom=variant&1?rooms.lf:rooms.lb;
    const kitchenRoom=variant&2?rooms.rb:rooms.rf,bathRoom=variant&2?rooms.rf:rooms.rb;
    living(livingRoom);kitchen(kitchenRoom);bedroom(bedRoom);bathroom(bathRoom);
    roomDoor(hall,bathRoom.z,1);
    group.userData.rooms=[{name:'Living room',...livingRoom},{name:'Kitchen',...kitchenRoom},{name:'Bedroom',...bedRoom},{name:'Bathroom',...bathRoom},{name:'Hallway',width:hallWidth,depth}];
  } else if(type==='gym') {
    gym(rooms.lf);gym(rooms.rf,true);gym(rooms.lb,true);bathroom(rooms.rb);plant(-hall-.4,halfD-.6);roomDoor(hall,rooms.rb.z,1);
    group.userData.rooms=['Cardio studio','Strength studio','Free weights','Changing room'];
  } else if(type==='hospital') {
    desk(rooms.lf.x,rooms.lf.z,true);hospital(rooms.rf);hospital(rooms.lb);bathroom(rooms.rb);plant(rooms.lf.maxX-.4,rooms.lf.maxZ-.5);
    group.userData.rooms=['Reception','Treatment room','Patient room','Washroom'];
  } else if(type==='restaurant'||type==='cafe') {
    for(const r of [rooms.lf,rooms.rf]){for(let i=0;i<Math.min(3,Math.floor(r.depth/2.8));i++)table(r.x,r.minZ+1.3+i*2.8,1.25,.82);plant(r.maxX-.4,r.maxZ-.55);}
    kitchen(rooms.lb);bathroom(rooms.rb);roomDoor(hall,rooms.rb.z,1);
    group.userData.rooms=['Dining room','Kitchen','Washroom'];
  } else if(type==='library'||type==='store') {
    shelves(rooms.lf,type==='library');shelves(rooms.rf,type==='library');desk(rooms.lb.x,rooms.lb.z);bathroom(rooms.rb);table(rooms.lf.x,rooms.lf.minZ+1.8,1.7,.8,type==='library');
    group.userData.rooms=[type==='library'?'Reading room':'Sales floor','Service desk','Washroom'];
  } else {
    for(const r of [rooms.lf,rooms.rf,rooms.lb]){const count=Math.min(3,Math.max(1,Math.floor(r.depth/2.8)));for(let i=0;i<count;i++)desk(r.x,r.minZ+1.3+i*2.8);}
    type==='school'?shelves(rooms.rb,true):bathroom(rooms.rb);plant(rooms.lf.minX+.4,rooms.lf.maxZ-.5);
    group.userData.rooms=[type==='school'?'Classroom':'Work area','Meeting room','Washroom'];
  }
  const ambient=new THREE.AmbientLight('#f0e6d8',1.0);dynamicGroup.add(ambient);
  for(const x of [-width*.25,width*.25])for(const z of [-depth*.25,depth*.25]) {
    const light=new THREE.PointLight('#f9e5c8',38,Math.max(width,depth)*.9,2);light.position.set(x,2.55,z);dynamicGroup.add(light);
    cy(staticGroup,.17,.04,x,2.71,z,white);cy(staticGroup,.125,.016,x,2.684,z,glow);
  }
  const spawn=toWorld(doorX,.015,halfD-1.45),exit=toWorld(doorX,0,halfD-.46),outside=door.clone().add(new THREE.Vector3(0,0,front*1.8));outside.y=.12;
  interaction('Leave building',doorX,1,halfD-.63,()=>({type:'exit',position:outside.clone()}),'exit',1.6);
  const bounds={minX:origin.x-halfW+.19,maxX:origin.x+halfW-.19,minZ:origin.z-halfD+.19,maxZ:origin.z+halfD-.19,floorY,width,depth};
  group.userData.bounds=bounds;group.userData.buildingId=building.id;
  mergeStatic(staticGroup,disposables);
  let disposed=false;
  function update(dt) {if(disposed)return;dt=THREE.MathUtils.clamp(Number(dt)||0,0,.1);for(const fn of updates)fn(dt);}
  function saveState() {return Object.fromEntries(interactables.map(item=>[item.id,JSON.parse(JSON.stringify(item.state))]));}
  function loadState(saved) {
    if(disposed||!saved||typeof saved!=='object')return;
    const entries=saved.interactables||saved;
    for(const item of interactables)if(entries[item.id]&&typeof entries[item.id]==='object'){
      Object.assign(item.state,entries[item.id]);item.applyState?.(true);
    }
    update(0);
  }
  function dispose() {if(disposed)return;disposed=true;group.removeFromParent();for(const g of disposables)g.dispose();for(const m of uniqueMaterials)m.dispose();colliders.length=0;interactables.length=0;updates.length=0;group.clear();}
  return {group,staticGroup,dynamicGroup,wallsGroup,spawn,exit,outside,colliders,interactables,bounds,floorBounds:bounds,floorY,update,saveState,loadState,dispose};
}
