import * as THREE from './vendor/three.module.js';
import { mergeGeometries } from './vendor/BufferGeometryUtils.js';
import { createCar } from './details.js';
import { createNPC as defaultNPC } from './characters.js';

const PAINTS = ['#8f9ca9', '#243443', '#aaa7a0', '#762f35', '#365a54', '#a99c80'];
const CAR_LENGTH = 4.55;
const TURN_RADIUS = 12;
const SIGNAL_PERIOD = 24; // Two 12-second directional phases, including amber/clearance.
const wrapAngle = n => Math.atan2(Math.sin(n), Math.cos(n));
const nodeKey = (x, z) => `${x}:${z}`;
const edgeKey = (a, b) => `${a.i},${a.j}>${b.i},${b.j}`;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const nearestIndex = (values, n) => values.reduce((best, v, i) => Math.abs(v - n) < Math.abs(values[best] - n) ? i : best, 0);

function randomGenerator(seed = 4179) {
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

// Collapse the detailed sedan once. The entire fleet shares common glass, trim,
// tires and lamps; only the paint batches are split into six colors.
function createFleet(group, count) {
  const samples = PAINTS.map(color => createCar(color));
  const prototype = samples[0];
  const paint = prototype.children[0].material;
  prototype.scale.setScalar(4.1);
  prototype.updateMatrixWorld(true);
  const byMaterial = new Map();
  prototype.traverse(mesh => {
    if (!mesh.isMesh) return;
    let g = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    if (g.index) { const raw = g; g = raw.toNonIndexed(); raw.dispose(); }
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!byMaterial.has(mesh.material)) byMaterial.set(mesh.material, []);
    byMaterial.get(mesh.material).push(g);
  });
  const batches = [];
  for (const [mat, geometries] of byMaterial) {
    const combined = mergeGeometries(geometries, false);
    geometries.forEach(g => g.dispose());
    if (!combined) throw new Error('Unable to merge sedan geometry');
    if (mat === paint) {
      for (let color = 0; color < PAINTS.length; color++) {
        const mesh = new THREE.InstancedMesh(combined, samples[color].children[0].material, Math.ceil(count / PAINTS.length));
        mesh.name = `Traffic paint ${color}`;
        mesh.count = 0;
        mesh.userData.paint = color;
        batches.push(mesh);
      }
    } else {
      const mesh = new THREE.InstancedMesh(combined, mat, count);
      mesh.userData.paint = -1;
      mesh.name = 'Shared traffic detail';
      batches.push(mesh);
    }
  }
  for (const mesh of batches) {
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
  }
  return batches;
}

export function createTraffic(scene, { roads = {}, buildings = [], bounds = {}, bridgeAreas = roads.bridgeAreas || [], createNPC = defaultNPC, night = true } = {}) {
  const random = randomGenerator();
  const group = new THREE.Group();
  group.name = 'Traffic and city life';
  scene.add(group);
  const xLines = roads.xLines || Array.from({ length: 13 }, (_, i) => -540 + i * 90);
  const zLines = roads.zLines || Array.from({ length: 11 }, (_, i) => -495 + i * 90);
  const halfWidth = roads.halfWidth ?? 6;
  const laneOffset = roads.laneOffset ?? 3;
  const sidewalkOffset = halfWidth + (roads.sidewalkWidth ?? 2.8) * .55;
  const limits = {
    minX: bounds.minX ?? roads.bounds?.minX ?? -630,
    maxX: bounds.maxX ?? roads.bounds?.maxX ?? 630,
    minZ: bounds.minZ ?? roads.bounds?.minZ ?? -540,
    maxZ: bounds.maxZ ?? roads.bounds?.maxZ ?? 540,
  };
  let simulationTime = 0;
  let lastTime = 0;
  const nodes = [];
  const at = (i, j) => nodes[j * xLines.length + i];
  for (let j = 0; j < zLines.length; j++) for (let i = 0; i < xLines.length; i++) {
    nodes.push({ i, j, x: xLines[i], z: zLines[j], key: nodeKey(i, j), owner: null, signalOffset: ((i + j) % 3) * 2 });
  }
  const neighbors = n => [at(n.i - 1, n.j), at(n.i + 1, n.j), at(n.i, n.j - 1), at(n.i, n.j + 1)].filter(v => v && Math.abs(v.i - n.i) + Math.abs(v.j - n.j) === 1);

  function signalAt(node, axis, time = simulationTime) {
    const phase = ((time + (node.signalOffset ?? 0)) % SIGNAL_PERIOD + SIGNAL_PERIOD) % SIGNAL_PERIOD;
    const directional = axis === 'x' ? phase : (phase + 12) % 24;
    const state = directional < 11 ? 'green' : directional < 11.6 ? 'amber' : 'red';
    return { state, phase, remaining: state === 'green' ? 11 - directional : 0 };
  }

  // Actual signal heads change color with the same state used by the drivers.
  const signalCount = nodes.length * 4;
  const pole = new THREE.InstancedMesh(new THREE.CylinderGeometry(.075, .09, 4.15, 6), new THREE.MeshStandardMaterial({ color: '#2b3338', roughness: .67, metalness: .45 }), signalCount);
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(.34, .96, .26), new THREE.MeshStandardMaterial({ color: '#182025', roughness: .7 }), signalCount);
  const bulbs = new THREE.InstancedMesh(new THREE.CircleGeometry(.085, 9), new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false }), signalCount * 3);
  [pole, heads, bulbs].forEach(mesh => { mesh.frustumCulled = false; group.add(mesh); });
  const dummy = new THREE.Object3D();
  const signalRefs = [];
  let signalIndex = 0;
  for (const node of nodes) for (const dir of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]) {
    const x = node.x - dir.x * 8.7 - dir.z * 8;
    const z = node.z - dir.z * 8.7 + dir.x * 8;
    const yaw = Math.atan2(-dir.x, -dir.z);
    dummy.position.set(x, 2.075, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); pole.setMatrixAt(signalIndex, dummy.matrix);
    dummy.position.y = 3.62; dummy.rotation.y = yaw; dummy.updateMatrix(); heads.setMatrixAt(signalIndex, dummy.matrix);
    for (let lamp = 0; lamp < 3; lamp++) {
      dummy.position.set(x - dir.x * .135, 3.92 - lamp * .30, z - dir.z * .135);
      dummy.updateMatrix(); bulbs.setMatrixAt(signalIndex * 3 + lamp, dummy.matrix);
    }
    signalRefs.push({ node, axis: dir.x ? 'x' : 'z' });
    signalIndex++;
  }
  pole.instanceMatrix.needsUpdate = heads.instanceMatrix.needsUpdate = bulbs.instanceMatrix.needsUpdate = true;
  const bulbColor = new THREE.Color();
  const lampColors = ['#ff4549', '#ffbb4c', '#62e8a2'];
  let nextSignalUpdate = -1;
  function updateSignals() {
    if (simulationTime < nextSignalUpdate) return;
    nextSignalUpdate = simulationTime + .12;
    signalRefs.forEach((ref, i) => {
      const state = signalAt(ref.node, ref.axis).state;
      const active = state === 'red' ? 0 : state === 'amber' ? 1 : 2;
      for (let lamp = 0; lamp < 3; lamp++) {
        bulbColor.set(lampColors[lamp]).multiplyScalar(active === lamp ? (night ? 2.2 : 1) : .045);
        bulbs.setColorAt(i * 3 + lamp, bulbColor);
      }
    });
    bulbs.instanceColor.needsUpdate = true;
  }

  const carCount = 40;
  const batches = createFleet(group, carCount);
  const cars = [];
  const edges = nodes.flatMap(from => neighbors(from).map(to => ({ from, to, center: { x: (from.x + to.x) / 2, z: (from.z + to.z) / 2 } })));
  const nearbyEdges = [...edges].sort((a, b) => Math.hypot(a.center.x, a.center.z - 26) - Math.hypot(b.center.x, b.center.z - 26));
  const usedEdges = new Set();
  function destination(car) {
    let target = nodes[Math.floor(random() * nodes.length)];
    for (let i = 0; i < 5 && distance(target, car.to) < 180; i++) target = nodes[Math.floor(random() * nodes.length)];
    return target;
  }
  function nextNode(car) {
    if (!car.destination || car.to === car.destination) car.destination = destination(car);
    const options = neighbors(car.to).filter(node => node !== car.from);
    options.sort((a, b) => distance(a, car.destination) - distance(b, car.destination));
    const tied = options.filter(node => Math.abs(distance(node, car.destination) - distance(options[0], car.destination)) < 1);
    return tied[Math.floor(random() * tied.length)] || car.from;
  }
  function setupEdge(car) {
    car.length = distance(car.from, car.to);
    car.dx = (car.to.x - car.from.x) / car.length;
    car.dz = (car.to.z - car.from.z) / car.length;
    car.lane = edgeKey(car.from, car.to);
    car.next = nextNode(car);
    car.curve = null;
    car.curveDistance = 0;
    car.phase = 'edge';
  }
  function startTurn(car) {
    const outgoingDistance = distance(car.to, car.next);
    const ox = (car.next.x - car.to.x) / outgoingDistance;
    const oz = (car.next.z - car.to.z) / outgoingDistance;
    const start = new THREE.Vector3(car.to.x - car.dx * TURN_RADIUS - car.dz * laneOffset, .07, car.to.z - car.dz * TURN_RADIUS + car.dx * laneOffset);
    const finish = new THREE.Vector3(car.to.x + ox * TURN_RADIUS - oz * laneOffset, .07, car.to.z + oz * TURN_RADIUS + ox * laneOffset);
    const tangentStart = start.clone().add(new THREE.Vector3(car.dx * TURN_RADIUS, 0, car.dz * TURN_RADIUS));
    const tangentEnd = finish.clone().sub(new THREE.Vector3(ox * TURN_RADIUS, 0, oz * TURN_RADIUS));
    car.curve = new THREE.CubicBezierCurve3(start, tangentStart, tangentEnd, finish);
    car.curve.arcLengthDivisions = 16;
    car.curveLength = car.curve.getLength();
    car.curveDistance = 0;
    car.phase = 'turn';
    car.to.owner = car.id;
  }
  function positionCar(car) {
    if (car.phase === 'turn') {
      const u = Math.min(1, car.curveDistance / car.curveLength);
      car.curve.getPointAt(u, car.position);
      const tangent = car.curve.getTangentAt(u);
      car.yaw = Math.atan2(-tangent.z, tangent.x);
    } else {
      car.position.set(car.from.x + car.dx * car.progress - car.dz * laneOffset, .07, car.from.z + car.dz * car.progress + car.dx * laneOffset);
      car.yaw = Math.atan2(-car.dz, car.dx);
    }
    for (const bridge of bridgeAreas) {
      if (car.position.x < bridge.minX || car.position.x > bridge.maxX || car.position.z < bridge.minZ || car.position.z > bridge.maxZ) continue;
      const ramp = THREE.MathUtils.clamp((car.position.z - bridge.rampStart) / (bridge.rampEnd - bridge.rampStart), 0, 1);
      car.position.y = bridge.groundHeight + (bridge.height - bridge.groundHeight) * ramp + .02;
    }
  }
  for (let id = 0; id < carCount; id++) {
    let edge = id < 18 ? nearbyEdges[id * 3] : edges[(id * 47) % edges.length];
    let offset = 0;
    while (usedEdges.has(edgeKey(edge.from, edge.to))) edge = edges[(id * 47 + ++offset) % edges.length];
    usedEdges.add(edgeKey(edge.from, edge.to));
    const car = { id, color: id % PAINTS.length, from: edge.from, to: edge.to, progress: 19 + random() * 43, speed: 0, cruise: 8.5 + random() * 3.5, position: new THREE.Vector3(), yaw: 0, destination: null, stoppedBy: null };
    car.initial = { from: edge.from, to: edge.to, progress: car.progress };
    setupEdge(car); positionCar(car); cars.push(car);
  }
  function syncFleet() {
    const paintCounts = new Array(PAINTS.length).fill(0);
    for (const car of cars) {
      dummy.position.copy(car.position); dummy.rotation.set(0, car.yaw, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix();
      const paintIndex = paintCounts[car.color]++;
      for (const mesh of batches) if (mesh.userData.paint === -1 || mesh.userData.paint === car.color) mesh.setMatrixAt(mesh.userData.paint === -1 ? car.id : paintIndex, dummy.matrix);
    }
    for (const mesh of batches) {
      if (mesh.userData.paint !== -1) mesh.count = paintCounts[mesh.userData.paint];
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  // Four-connected sidewalk corners form a real navigation graph. Short edges
  // cross streets; long edges remain on the pavements between intersections.
  const walkX = xLines.flatMap(x => [x - sidewalkOffset, x + sidewalkOffset]).sort((a, b) => a - b);
  const walkZ = zLines.flatMap(z => [z - sidewalkOffset, z + sidewalkOffset]).sort((a, b) => a - b);
  const walkPoint = (i, j) => new THREE.Vector3(walkX[i], .16, walkZ[j]);
  function gridPath(start, finish) {
    const result = [];
    let i = start.i, j = start.j;
    while (i !== finish.i || j !== finish.j) {
      const horizontal = i !== finish.i && (j === finish.j || Math.abs(finish.i - i) >= Math.abs(finish.j - j));
      if (horizontal) i += Math.sign(finish.i - i); else j += Math.sign(finish.j - j);
      result.push(walkPoint(i, j));
    }
    return result;
  }
  function streetAccess(position, building) {
    if (building?.door) {
      const road = zLines[nearestIndex(zLines, position.z)];
      const side = Math.sign(position.z - road) || building.front || 1;
      const access = new THREE.Vector3(position.x, .16, road + side * sidewalkOffset);
      const i = nearestIndex(walkX, access.x), j = nearestIndex(walkZ, access.z);
      return { access, grid: { i, j }, corner: walkPoint(i, j) };
    }
    const i = nearestIndex(walkX, position.x), j = nearestIndex(walkZ, position.z);
    const vertical = Math.abs(walkX[i] - position.x) < Math.abs(walkZ[j] - position.z);
    const access = new THREE.Vector3(vertical ? walkX[i] : position.x, .16, vertical ? position.z : walkZ[j]);
    return { access, grid: { i, j }, corner: walkPoint(i, j) };
  }
  function planWalk(start, building, startBuilding = null) {
    const end = building.door.clone().setY(.16);
    const a = streetAccess(start, startBuilding), b = streetAccess(end, building);
    const raw = [a.access, a.corner, ...gridPath(a.grid, b.grid), b.access, end];
    const route = [];
    let previous = start;
    for (const p of raw) if (p.distanceTo(previous) > .05) { route.push(p); previous = p; }
    return route;
  }
  const destinations = buildings.filter(b => b.door && b.position);
  const ofType = types => destinations.filter(b => types.includes(b.type));
  const places = {
    home: ofType(['house', 'townhouse', 'apartment']),
    work: ofType(['office', 'hospital', 'school', 'library']),
    gym: ofType(['gym']), restaurant: ofType(['restaurant', 'cafe']), store: ofType(['store']),
  };
  for (const kind of Object.keys(places)) if (!places[kind].length) places[kind] = destinations;
  const agents = [];
  const population = 30;
  function choosePlace(agent, purpose) {
    if (purpose === 'home' && agent.home) return agent.home;
    if (purpose === 'work' && agent.work) return agent.work;
    const candidates = [...places[purpose]].sort((a, b) => distance(a.door, agent.position) - distance(b.door, agent.position));
    return candidates[agent.id % Math.min(4, candidates.length)] || null;
  }
  function scheduledPurpose(id, hour) {
    if (hour < 7 || hour >= 21) return 'home';
    if (hour < 8) return id % 4 === 0 ? 'gym' : 'home';
    if (hour >= 12 && hour < 13) return 'restaurant';
    if (hour < 17) return 'work';
    if (hour < 19) return ['gym', 'store', 'restaurant'][id % 3];
    return 'restaurant';
  }
  function setDestination(agent, purpose) {
    const building = choosePlace(agent, purpose);
    const startBuilding = agent.indoors ? agent.destination : null;
    agent.purpose = purpose;
    agent.destination = building;
    agent.indoors = false;
    agent.route = building ? planWalk(agent.position, building, startBuilding) : [];
    agent.routeIndex = 0;
    agent.crossing = false;
    agent.waiting = false;
  }
  const initialX = xLines[nearestIndex(xLines, 0)];
  for (let id = 0; id < population; id++) {
    let position;
    if (id < 12) position = new THREE.Vector3(initialX + (id % 2 ? sidewalkOffset : -sidewalkOffset), .16, 13.4 + Math.floor(id / 2) * 4.2);
    else {
      const n = nodes[(id * 29) % nodes.length];
      position = new THREE.Vector3(n.x + (id % 2 ? sidewalkOffset : -sidewalkOffset), .16, n.z + sidewalkOffset);
    }
    const agent = { id, position, initial: position.clone(), speed: 1.13 + random() * .32, yaw: 0, route: [], routeIndex: 0, purpose: '', destination: null, indoors: false, dead: false, waiting: false, crossing: false, dwellUntil: 0, model: null };
    agent.home = choosePlace(agent, 'home'); agent.work = choosePlace(agent, 'work');
    setDestination(agent, scheduledPurpose(id, 18));
    agents.push(agent);
  }
  const npcs = [];
  function bindModel(model, agent) {
    if (model.agent) model.agent.model = null;
    model.agent = agent; agent.model = model;
    model.group.position.copy(agent.position); model.group.rotation.set(0, agent.yaw, 0);
    model.spawn.copy(agent.initial); model.purpose = agent.purpose;
  }
  for (let i = 0; i < 12; i++) {
    const model = createNPC(i);
    model.dead = false; model.deathTime = -Infinity; model.spawn = agents[i].initial.clone(); model.knock = new THREE.Vector3();
    model.group.name = `Resident ${i + 1}`;
    group.add(model.group); bindModel(model, agents[i]); npcs.push(model);
  }
  function crossingInfo(start, end) {
    const length = distance(start, end);
    if (length > sidewalkOffset * 2 + .2 || length < 10) return null;
    const axis = Math.abs(end.x - start.x) > Math.abs(end.z - start.z) ? 'x' : 'z';
    const midX = (start.x + end.x) / 2, midZ = (start.z + end.z) / 2;
    const node = at(nearestIndex(xLines, midX), nearestIndex(zLines, midZ));
    const center = axis === 'x' ? xLines[nearestIndex(xLines, midX)] : zLines[nearestIndex(zLines, midZ)];
    if (Math.abs((axis === 'x' ? midX : midZ) - center) > .1) return null;
    return { node, axis, length };
  }
  function updateAgents(dt, time, hero) {
    const hour = (18 + simulationTime / 20) % 24;
    for (const model of npcs) {
      const agent = model.agent;
      if (model.dead) {
        agent.dead = true;
        model.group.rotation.x = THREE.MathUtils.damp(model.group.rotation.x, -Math.PI / 2, 8, dt);
        model.group.position.addScaledVector(model.knock, dt); model.knock.multiplyScalar(Math.exp(-dt * 4)); model.group.position.y = .16;
        agent.position.copy(model.group.position);
        if (time - model.deathTime >= 22 && distance(model.group.position, hero) > 55) {
          model.dead = false; model.deathTime = -Infinity; model.knock.set(0, 0, 0); model.group.rotation.x = 0; agent.dead = false;
          const access = streetAccess(agent.position); agent.position.copy(access.access);
          setDestination(agent, scheduledPurpose(agent.id, hour));
        }
      } else agent.dead = false;
    }
    for (const agent of agents) {
      if (agent.dead) continue;
      const purpose = scheduledPurpose(agent.id, hour);
      if (agent.indoors) {
        if (purpose !== agent.purpose && simulationTime >= agent.dwellUntil) setDestination(agent, purpose);
        else continue;
      }
      // Complete each visit before accepting a changed schedule; nobody pops
      // between locations simply because the accelerated clock changed hour.
      if (agent.routeIndex >= agent.route.length) {
        if (agent.destination) { agent.indoors = true; agent.dwellUntil = simulationTime + (agent.purpose === 'home' ? 20 : 8); }
        else if (purpose !== agent.purpose) setDestination(agent, purpose);
        continue;
      }
      const goal = agent.route[agent.routeIndex];
      const previous = agent.routeIndex ? agent.route[agent.routeIndex - 1] : agent.initial;
      const crossing = crossingInfo(previous, goal);
      const remaining = distance(agent.position, goal);
      agent.waiting = false;
      if (crossing && !agent.crossing) {
        const light = signalAt(crossing.node, crossing.axis);
        if (light.state !== 'green' || light.remaining < crossing.length / 1.6 + .25 || crossing.node.owner !== null) { agent.waiting = true; continue; }
        agent.crossing = true;
      }
      if (hero.y < 3 && remaining > .3 && distance(agent.position, hero) < 1.1) { agent.waiting = true; continue; }
      const pace = agent.crossing ? 1.6 : agent.speed;
      const step = Math.min(remaining, pace * dt);
      if (remaining > .001) {
        const dx = (goal.x - agent.position.x) / remaining, dz = (goal.z - agent.position.z) / remaining;
        agent.position.x += dx * step; agent.position.z += dz * step;
        const yaw = Math.atan2(-dx, -dz); agent.yaw += wrapAngle(yaw - agent.yaw) * Math.min(1, dt * 8);
      }
      if (remaining <= step + .02) { agent.position.copy(goal); agent.routeIndex++; agent.crossing = false; }
    }
    // Model slots are only reassigned beyond 60 m. The logical resident keeps
    // walking while unrendered, so a new view reveals continuing journeys.
    const candidates = agents.filter(a => !a.dead && !a.indoors && !a.model).sort((a, b) => distance(a.position, hero) - distance(b.position, hero));
    for (const model of npcs) {
      const currentDistance = distance(model.group.position, hero);
      if (!model.dead && currentDistance > 200 && candidates.length) {
        const index = candidates.findIndex(a => distance(a.position, hero) > 60 && distance(a.position, hero) < currentDistance - 30);
        if (index >= 0) bindModel(model, candidates.splice(index, 1)[0]);
      }
      const agent = model.agent;
      if (!model.dead) {
        model.group.position.copy(agent.position); model.group.rotation.y = agent.yaw;
        model.group.visible = !agent.indoors && distance(agent.position, hero) < 210;
        model.purpose = agent.purpose;
        model.animate(time + agent.id * .34, agent.waiting || agent.indoors ? 0 : agent.crossing ? 1.6 : agent.speed);
      } else model.group.visible = currentDistance < 220;
    }
  }

  function updateCars(dt, hero) {
    const queues = new Map();
    for (const car of cars) {
      if (!queues.has(car.lane)) queues.set(car.lane, []);
      queues.get(car.lane).push(car);
    }
    const leaders = new Map();
    for (const list of queues.values()) {
      list.sort((a, b) => (b.progress + (b.curveDistance || 0)) - (a.progress + (a.curveDistance || 0)));
      for (let i = 1; i < list.length; i++) leaders.set(list[i].id, { car: list[i - 1], gap: list[i - 1].progress + (list[i - 1].curveDistance || 0) - list[i].progress - CAR_LENGTH });
    }
    for (const car of cars) {
      let targetSpeed = car.cruise;
      let permitted = Infinity;
      let canEnterIntersection = true;
      car.stoppedBy = null;
      if (car.phase === 'edge') {
        const light = signalAt(car.to, car.dx ? 'x' : 'z');
        const pedestrian = agents.some(agent => agent.crossing && !agent.dead && distance(agent.position, car.to) < 15);
        const exitLane = edgeKey(car.to, car.next);
        const blockedExit = cars.some(other => other.id !== car.id && other.lane === exitLane && other.progress < TURN_RADIUS + CAR_LENGTH + 3.2);
        const gated = light.state !== 'green' || (car.to.owner !== null && car.to.owner !== car.id) || pedestrian || blockedExit;
        canEnterIntersection = !gated;
        if (gated) {
          const stopDistance = Math.max(0, car.length - TURN_RADIUS - car.progress);
          targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * 3.8 * stopDistance));
          permitted = stopDistance;
          car.stoppedBy = pedestrian ? 'pedestrian' : light.state !== 'green' ? 'signal' : blockedExit ? 'queue' : 'intersection';
        }
      } else {
        targetSpeed = Math.min(targetSpeed, 6.5);
        const exitLane = edgeKey(car.to, car.next);
        const exitCar = cars.filter(other => other.id !== car.id && other.lane === exitLane).sort((a, b) => a.progress - b.progress)[0];
        if (exitCar) {
          const exitGap = Math.max(0, car.curveLength - car.curveDistance + exitCar.progress - TURN_RADIUS - CAR_LENGTH - 2.2);
          permitted = Math.min(permitted, exitGap);
          targetSpeed = Math.min(targetSpeed, exitCar.speed + exitGap * .5);
          if (exitGap < 8) car.stoppedBy = 'queue';
        }
      }
      const leader = leaders.get(car.id);
      if (leader) {
        const safeGap = Math.max(0, leader.gap - 2.2);
        targetSpeed = Math.min(targetSpeed, leader.car.speed + safeGap * .5);
        permitted = Math.min(permitted, safeGap);
        if (safeGap < 8) car.stoppedBy = 'queue';
      }
      if (hero.y < 3) {
        const dx = hero.x - car.position.x, dz = hero.z - car.position.z;
        const forward = dx * Math.cos(car.yaw) - dz * Math.sin(car.yaw);
        const lateral = Math.abs(dx * Math.sin(car.yaw) + dz * Math.cos(car.yaw));
        if (forward > 0 && forward < 11 && lateral < 1.8) {
          permitted = Math.min(permitted, Math.max(0, forward - 4));
          targetSpeed = Math.min(targetSpeed, Math.sqrt(2 * 4 * Math.max(0, forward - 4)));
          car.stoppedBy = 'player';
        }
      }
      car.speed += THREE.MathUtils.clamp(targetSpeed - car.speed, -4.5 * dt, 2.1 * dt);
      const advance = Math.min(Math.max(0, car.speed * dt), permitted);
      if (advance < car.speed * dt) car.speed = dt ? advance / dt : 0;
      if (car.phase === 'edge') {
        car.progress += advance;
        if (car.progress >= car.length - TURN_RADIUS - .001 && permitted > .01 && canEnterIntersection) {
          car.progress = car.length - TURN_RADIUS;
          startTurn(car);
        }
      } else {
        car.curveDistance += advance;
        if (car.curveDistance >= car.curveLength) {
          const overflow = car.curveDistance - car.curveLength;
          car.to.owner = null;
          car.from = car.to; car.to = car.next; car.progress = TURN_RADIUS + overflow;
          setupEdge(car);
        }
      }
      positionCar(car);
    }
    syncFleet();
  }

  function update(dt, time = lastTime + dt, heroPosition = new THREE.Vector3(0, .15, 26)) {
    dt = THREE.MathUtils.clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    lastTime = Number.isFinite(time) ? time : lastTime + dt;
    simulationTime += dt;
    updateAgents(dt, lastTime, heroPosition);
    updateCars(dt, heroPosition);
    updateSignals();
  }
  function reset() {
    simulationTime = 0; nextSignalUpdate = -1;
    nodes.forEach(node => { node.owner = null; });
    agents.forEach(agent => {
      agent.position.copy(agent.initial); agent.dead = false; agent.indoors = false; agent.dwellUntil = 0; agent.yaw = 0; agent.model = null;
      setDestination(agent, scheduledPurpose(agent.id, 18));
    });
    npcs.forEach((model, i) => {
      model.agent = null; model.dead = false; model.deathTime = -Infinity; model.knock.set(0, 0, 0);
      bindModel(model, agents[i]); model.group.visible = true;
    });
    cars.forEach(car => {
      car.from = car.initial.from; car.to = car.initial.to; car.progress = car.initial.progress;
      car.speed = 0; car.destination = null; setupEdge(car); positionCar(car);
    });
    syncFleet(); updateSignals();
  }
  function stats() {
    return {
      carCount: cars.length, visibleNPCCount: npcs.filter(n => n.group.visible).length, population: agents.length,
      timeHour: (18 + simulationTime / 20) % 24, signalCycleSeconds: SIGNAL_PERIOD,
      signalStates: nodes.map(n => ({ x: n.x, z: n.z, xState: signalAt(n, 'x').state, zState: signalAt(n, 'z').state, phase: signalAt(n, 'x').phase, occupied: n.owner !== null })),
      cars: cars.map(c => ({ id: c.id, x: c.position.x, z: c.position.z, speed: c.speed, lane: c.lane, progress: c.progress, laneProgress: c.progress + (c.curveDistance || 0), phase: c.phase, stoppedBy: c.stoppedBy })),
      schedules: agents.map(a => ({ id: a.id, purpose: a.purpose, nextPurpose: scheduledPurpose(a.id, (18 + simulationTime / 20) % 24), destination: a.destination?.name || a.destination?.type || null, indoors: a.indoors, walking: !a.dead && !a.indoors && !a.waiting, x: a.position.x, z: a.position.z })),
      bounds: { ...limits }, vehicleDrawCalls: batches.length,
    };
  }
  syncFleet(); updateSignals();
  return { group, npcs, update, reset, stats, signalAt, planWalk };
}
