import * as THREE from './vendor/three.module.js';

// The city stays GPU-instanced. Only pieces struck by an impact are animated.
export function createDestructionSystem(scene, staticMeshes) {
  const records = [];
  const destroyedInstances = new Set();
  const collapses = [];
  const dirtyMeshes = new Set();
  const matrix = new THREE.Matrix4();
  const worldMatrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const transform = new THREE.Object3D();
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const tilt = new THREE.Quaternion();
  const axis = new THREE.Vector3();

  for (const mesh of staticMeshes) {
    if (!mesh.isInstancedMesh || mesh.geometry.type !== 'BoxGeometry') continue;
    mesh.updateWorldMatrix(true, false);
    const landmarks = mesh.userData.landmarks || [];
    for (let index = 0; index < mesh.count; index++) {
      if (!landmarks[index] || landmarks[index] === 'gardens') continue;
      mesh.getMatrixAt(index, matrix);
      matrix.decompose(position, quaternion, scale);
      worldMatrix.multiplyMatrices(mesh.matrixWorld, matrix);
      const bounds = new THREE.Box3(new THREE.Vector3(-.5, -.5, -.5), new THREE.Vector3(.5, .5, .5)).applyMatrix4(worldMatrix);
      const center = bounds.getCenter(new THREE.Vector3());
      const size = bounds.getSize(new THREE.Vector3());
      // Foundations are retained so explosions never remove roads or terrain.
      if (size.y < .16 && center.y < .75) continue;
      records.push({
        mesh, index, key: `${mesh.uuid}:${index}`, original: matrix.clone(),
        position: position.clone(), quaternion: quaternion.clone(), scale: scale.clone(),
        center, bounds, size, volume: size.x * size.y * size.z,
      });
    }
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }

  const chunkCount = 120;
  const fadeValues = new Float32Array(chunkCount);
  const chunkGeometry = new THREE.BoxGeometry(1, 1, 1);
  const fadeAttribute = new THREE.InstancedBufferAttribute(fadeValues, 1).setUsage(THREE.DynamicDrawUsage);
  chunkGeometry.setAttribute('chunkFade', fadeAttribute);
  const chunkMaterial = new THREE.MeshStandardMaterial({ color: '#9a9692', roughness: .92, metalness: .06, emissive: '#52200b', emissiveIntensity: .24, transparent: true, depthWrite: false });
  chunkMaterial.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float chunkFade;\nvarying float vChunkFade;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvChunkFade = chunkFade;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vChunkFade;')
      .replace('#include <dithering_fragment>', 'gl_FragColor.a *= vChunkFade;\n#include <dithering_fragment>');
  };
  const chunks = new THREE.InstancedMesh(chunkGeometry, chunkMaterial, chunkCount);
  chunks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  chunks.frustumCulled = false;
  chunks.receiveShadow = true;
  chunks.visible = false;
  chunks.name = 'impact-rubble';
  const palette = ['#827e79', '#ada69c', '#5d6064', '#8f969a'];
  const chunkPool = Array.from({ length: chunkCount }, (_, index) => {
    chunks.setMatrixAt(index, hiddenMatrix);
    chunks.setColorAt(index, new THREE.Color(palette[index % palette.length]));
    return { active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), rotation: new THREE.Euler(), angular: new THREE.Vector3(), size: new THREE.Vector3(), age: 0, lifetime: 0, bounces: 0 };
  });
  scene.add(chunks);
  let chunkCursor = 0;

  const sparkCount = 80;
  const sparkPositions = new Float32Array(sparkCount * 3);
  const sparkStrengths = new Float32Array(sparkCount);
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3).setUsage(THREE.DynamicDrawUsage));
  sparkGeometry.setAttribute('strength', new THREE.BufferAttribute(sparkStrengths, 1).setUsage(THREE.DynamicDrawUsage));
  const sparkMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { pixelScale: { value: Math.min(window.devicePixelRatio || 1, 1.75) } },
    vertexShader: 'attribute float strength; varying float vStrength; uniform float pixelScale; void main(){vStrength=strength;vec4 p=modelViewMatrix*vec4(position,1.);gl_PointSize=clamp(42.*pixelScale/max(1.,-p.z),1.,7.);gl_Position=projectionMatrix*p;}',
    fragmentShader: 'varying float vStrength; void main(){float glow=pow(max(0.,1.-length(gl_PointCoord-.5)*2.),2.);gl_FragColor=vec4(1.,.45,.12,glow*vStrength);}',
  });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  sparks.visible = false;
  sparks.name = 'impact-sparks';
  scene.add(sparks);
  const sparkPool = Array.from({ length: sparkCount }, () => ({ active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), age: 0, lifetime: 0 }));
  let sparkCursor = 0;

  const ringGeometry = new THREE.RingGeometry(.84, 1, 36);
  const rings = Array.from({ length: 4 }, () => {
    const material = new THREE.MeshBasicMaterial({ color: '#ffb35f', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(ringGeometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, age: 0, radius: 1 };
  });
  let ringCursor = 0;

  function spawnRubble(record, impact, power) {
    chunks.visible = true;
    const count = Math.max(3, Math.min(7, Math.ceil(record.volume / 10)));
    const size = Math.max(.13, Math.min(.7, Math.cbrt(record.volume / (count * 16))));
    for (let i = 0; i < count; i++) {
      const chunk = chunkPool[chunkCursor];
      chunkCursor = (chunkCursor + 1) % chunkCount;
      chunk.active = true;
      chunk.age = 0;
      chunk.lifetime = 5 + Math.random() * 3;
      chunk.bounces = 0;
      chunk.position.set(
        record.center.x + (Math.random() - .5) * Math.min(record.size.x, 3),
        Math.max(.5, Math.min(record.center.y, impact.y + 1.8)) + Math.random() * 1.5,
        record.center.z + (Math.random() - .5) * Math.min(record.size.z, 3),
      );
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.1 + Math.random() * (2 + power);
      chunk.velocity.set(Math.cos(angle) * speed, 1.5 + Math.random() * 3.5, Math.sin(angle) * speed);
      chunk.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      chunk.angular.set(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2);
      chunk.size.set(size * (.6 + Math.random()), size * (.45 + Math.random() * .65), size * (.6 + Math.random()));
    }
  }

  function burst(point, radius) {
    sparks.visible = true;
    const ring = rings[ringCursor];
    ringCursor = (ringCursor + 1) % rings.length;
    ring.age = 0;
    ring.radius = radius;
    ring.mesh.position.copy(point);
    ring.mesh.position.y = Math.max(.24, point.y + .015);
    ring.mesh.scale.setScalar(.1);
    ring.mesh.material.opacity = .8;
    ring.mesh.visible = true;
    for (let i = 0; i < 26; i++) {
      const spark = sparkPool[sparkCursor];
      sparkCursor = (sparkCursor + 1) % sparkCount;
      spark.active = true;
      spark.age = 0;
      spark.lifetime = .45 + Math.random() * .7;
      spark.position.copy(point);
      spark.velocity.set((Math.random() - .5) * 9, 1 + Math.random() * 6, (Math.random() - .5) * 9);
    }
  }

  function destroyNear(point, radius = 2.4, power = 1) {
    if (!point || !Number.isFinite(point.x + point.y + point.z)) return 0;
    radius = THREE.MathUtils.clamp(Number(radius) || 2.4, .2, 6);
    power = THREE.MathUtils.clamp(Number(power) || 1, .25, 4);
    const candidates = [];
    for (const record of records) {
      if (destroyedInstances.has(record.key)) continue;
      const distance = record.bounds.distanceToPoint(point);
      if (distance <= radius) candidates.push({ record, distance });
    }
    // Large structural pieces go first; a burst has a firm per-frame budget.
    candidates.sort((a, b) => (b.record.volume / (1 + b.distance * 2)) - (a.record.volume / (1 + a.distance * 2)));
    const limit = Math.min(8, Math.max(1, Math.round(4 + power * 2)));
    const selected = candidates.slice(0, limit);
    for (const { record } of selected) {
      destroyedInstances.add(record.key);
      collapses.push({ record, age: 0, duration: .34 + Math.random() * .22, direction: Math.random() < .5 ? -1 : 1 });
      spawnRubble(record, point, power);
    }
    burst(point, radius);
    return selected.length;
  }

  function update(dt) {
    dt = Math.min(.05, Math.max(0, Number(dt) || 0));
    const changed = collapses.length > 0;
    for (let i = collapses.length - 1; i >= 0; i--) {
      const collapse = collapses[i];
      const record = collapse.record;
      collapse.age += dt;
      const t = Math.min(1, collapse.age / collapse.duration);
      if (t === 1) {
        record.mesh.setMatrixAt(record.index, hiddenMatrix);
        collapses.splice(i, 1);
      } else {
        const ease = t * t;
        transform.position.copy(record.position);
        transform.position.y -= record.size.y * .47 * ease;
        transform.scale.copy(record.scale);
        transform.scale.y *= 1 - ease * .94;
        transform.scale.x *= 1 - t * .2;
        transform.scale.z *= 1 - t * .2;
        axis.set(0, 0, 1);
        tilt.setFromAxisAngle(axis, collapse.direction * ease * .12);
        transform.quaternion.copy(record.quaternion).multiply(tilt);
        transform.updateMatrix();
        record.mesh.setMatrixAt(record.index, transform.matrix);
      }
      dirtyMeshes.add(record.mesh);
    }
    for (const mesh of dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
    dirtyMeshes.clear();

    let chunksChanged = false, activeChunks = 0;
    for (let i = 0; i < chunkCount; i++) {
      const chunk = chunkPool[i];
      if (!chunk.active) continue;
      chunksChanged = true;
      chunk.age += dt;
      if (chunk.age >= chunk.lifetime) {
        chunk.active = false;
        fadeValues[i] = 0;
        chunks.setMatrixAt(i, hiddenMatrix);
        continue;
      }
      activeChunks++;
      if (chunk.bounces < 3) {
        chunk.velocity.y -= 11 * dt;
        chunk.position.addScaledVector(chunk.velocity, dt);
        const floor = .23 + chunk.size.y * .5;
        if (chunk.position.y <= floor) {
          chunk.position.y = floor;
          chunk.velocity.y = Math.abs(chunk.velocity.y) * .3;
          chunk.velocity.x *= .58;
          chunk.velocity.z *= .58;
          chunk.angular.multiplyScalar(.55);
          chunk.bounces++;
        }
        chunk.rotation.x += chunk.angular.x * dt;
        chunk.rotation.y += chunk.angular.y * dt;
        chunk.rotation.z += chunk.angular.z * dt;
      }
      transform.position.copy(chunk.position);
      transform.rotation.copy(chunk.rotation);
      transform.scale.copy(chunk.size);
      transform.updateMatrix();
      chunks.setMatrixAt(i, transform.matrix);
      fadeValues[i] = Math.min(1, (chunk.lifetime - chunk.age) / 1.5);
    }
    if (chunksChanged) {
      chunks.instanceMatrix.needsUpdate = true;
      fadeAttribute.needsUpdate = true;
    }
    chunks.visible = activeChunks > 0;

    let sparksChanged = false, activeSparks = 0;
    for (let i = 0; i < sparkCount; i++) {
      const spark = sparkPool[i];
      if (!spark.active) continue;
      sparksChanged = true;
      spark.age += dt;
      if (spark.age >= spark.lifetime) {
        spark.active = false;
        sparkStrengths[i] = 0;
        continue;
      }
      activeSparks++;
      spark.velocity.y -= 7 * dt;
      spark.position.addScaledVector(spark.velocity, dt);
      sparkPositions[i * 3] = spark.position.x;
      sparkPositions[i * 3 + 1] = spark.position.y;
      sparkPositions[i * 3 + 2] = spark.position.z;
      sparkStrengths[i] = Math.pow(1 - spark.age / spark.lifetime, 1.4);
    }
    if (sparksChanged) {
      sparkGeometry.attributes.position.needsUpdate = true;
      sparkGeometry.attributes.strength.needsUpdate = true;
    }
    sparks.visible = activeSparks > 0;
    for (const ring of rings) {
      if (!ring.mesh.visible) continue;
      ring.age += dt;
      const t = ring.age / .5;
      ring.mesh.visible = t < 1;
      ring.mesh.scale.setScalar(.1 + ring.radius * t * 1.5);
      ring.mesh.material.opacity = Math.max(0, .65 * (1 - t) * (1 - t));
    }
    return changed;
  }

  function reset() {
    for (const record of records) {
      if (!destroyedInstances.has(record.key)) continue;
      record.mesh.setMatrixAt(record.index, record.original);
      dirtyMeshes.add(record.mesh);
    }
    for (const mesh of dirtyMeshes) mesh.instanceMatrix.needsUpdate = true;
    dirtyMeshes.clear();
    destroyedInstances.clear();
    collapses.length = 0;
    chunkPool.forEach((chunk, index) => { chunk.active = false; chunks.setMatrixAt(index, hiddenMatrix); });
    fadeValues.fill(0);
    fadeAttribute.needsUpdate = true;
    chunks.instanceMatrix.needsUpdate = true;
    chunks.visible = false;
    sparkPool.forEach(spark => { spark.active = false; });
    sparkStrengths.fill(0);
    sparkGeometry.attributes.strength.needsUpdate = true;
    sparks.visible = false;
    rings.forEach(ring => { ring.mesh.visible = false; });
  }

  return {
    destroyNear, update, reset, destroyedInstances,
    isDestroyed: (object, instanceId) => destroyedInstances.has(`${object.uuid}:${instanceId}`),
  };
}
