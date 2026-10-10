import * as THREE from './vendor/three.module.js';

const isRemoved = (box, destruction) => !!destruction?.isDestroyed?.(box.object, box.index);

export function getSurfaceHeight(point, { colliders = [], destruction, worldScale = 3 } = {}) {
  const s = Math.max(.01, worldScale);
  let height = .22 * s;
  if (point.z >= 8 * s && point.z <= 17 * s && Math.abs(point.x - 10 * s) <= 1.075 * s) height = 1.03 * s;
  for (const box of colliders) {
    if (isRemoved(box, destruction)) continue;
    if (Math.abs(point.x - box.center.x) <= Math.abs(box.scale.x) / 2 + .05
      && Math.abs(point.z - box.center.z) <= Math.abs(box.scale.z) / 2 + .05) {
      height = Math.max(height, box.center.y + Math.abs(box.scale.y) / 2 + .02);
    }
  }
  return height;
}

export function blockedByBuilding(point, { colliders = [], destruction, margin = .3 } = {}) {
  for (const box of colliders) {
    if (isRemoved(box, destruction)) continue;
    if (point.y >= box.center.y + Math.abs(box.scale.y) / 2 - .1) continue;
    if (Math.abs(point.x - box.center.x) < Math.abs(box.scale.x) / 2 + margin
      && Math.abs(point.z - box.center.z) < Math.abs(box.scale.z) / 2 + margin) return true;
  }
  return false;
}

// Heading is the hero's yaw: 0 faces -Z. Vehicle dimensions are real metres.
export function constrainGroundMove(old, next, {
  colliders = [], destruction, driving = false, worldScale = 3, heading = 0,
} = {}) {
  const s = Math.max(.01, worldScale);
  const forwardX = -Math.sin(heading), forwardZ = -Math.cos(heading);
  const rightX = Math.cos(heading), rightZ = -Math.sin(heading);
  const halfLength = driving ? 2.2 : .24;
  const halfWidth = driving ? 1 : .24;
  const extentX = Math.abs(forwardX) * halfLength + Math.abs(rightX) * halfWidth;
  const extentZ = Math.abs(forwardZ) * halfLength + Math.abs(rightZ) * halfWidth;
  const minX = -19.5 * s, maxX = 19.5 * s;
  const minZ = -16.5 * s, maxZ = 17 * s;
  const shore = 8.25 * s, bridgeX = 10 * s, bridgeHalfWidth = 1.075 * s;
  const offsets = [
    [forwardX * halfLength + rightX * halfWidth, forwardZ * halfLength + rightZ * halfWidth],
    [forwardX * halfLength - rightX * halfWidth, forwardZ * halfLength - rightZ * halfWidth],
    [-forwardX * halfLength - rightX * halfWidth, -forwardZ * halfLength - rightZ * halfWidth],
    [-forwardX * halfLength + rightX * halfWidth, -forwardZ * halfLength + rightZ * halfWidth],
  ];

  function supported(point) {
    for (const [x, z] of offsets) {
      const px = point.x + x, pz = point.z + z;
      if (px < minX || px > maxX || pz < minZ || pz > maxZ) return false;
      if (pz > shore && Math.abs(px - bridgeX) > bridgeHalfWidth) return false;
    }
    // Corners can straddle the concave shore/bridge junction; test crossing edges too.
    for (let i = 0; i < offsets.length; i++) {
      const a = offsets[i], b = offsets[(i + 1) % offsets.length];
      const az = point.z + a[1], bz = point.z + b[1];
      if ((az < shore && bz > shore) || (bz < shore && az > shore)) {
        const fraction = (shore - az) / (bz - az);
        const x = point.x + a[0] + (b[0] - a[0]) * fraction;
        if (Math.abs(x - bridgeX) > bridgeHalfWidth) return false;
      }
    }
    return true;
  }

  function intersectsBuilding(point) {
    if (!driving) return blockedByBuilding(point, { colliders, destruction, margin: .24 });
    for (const box of colliders) {
      if (isRemoved(box, destruction)) continue;
      if (point.y >= box.center.y + Math.abs(box.scale.y) / 2 - .1) continue;
      const bx = Math.abs(box.scale.x) / 2 + .06, bz = Math.abs(box.scale.z) / 2 + .06;
      const dx = point.x - box.center.x, dz = point.z - box.center.z;
      // Separating axes keep every part of the rotated car clear of a building.
      if (Math.abs(dx) >= bx + extentX || Math.abs(dz) >= bz + extentZ) continue;
      if (Math.abs(dx * forwardX + dz * forwardZ) >= halfLength + bx * Math.abs(forwardX) + bz * Math.abs(forwardZ)) continue;
      if (Math.abs(dx * rightX + dz * rightZ) >= halfWidth + bx * Math.abs(rightX) + bz * Math.abs(rightZ)) continue;
      return true;
    }
    return false;
  }

  const valid = point => supported(point) && !intersectsBuilding(point);
  const desired = new THREE.Vector3(
    THREE.MathUtils.clamp(next.x, minX + extentX, maxX - extentX), next.y,
    THREE.MathUtils.clamp(next.z, minZ + extentZ, maxZ - extentZ),
  );
  if (valid(desired)) return desired;

  const origin = new THREE.Vector3(old.x, next.y, old.z);
  if (!supported(origin)) {
    // Recover cleanly if driving is enabled while the hero is flying over water.
    const land = desired.clone();
    land.z = Math.min(land.z, shore - extentZ - .001);
    const bridge = desired.clone();
    bridge.x = bridgeX;
    bridge.z = THREE.MathUtils.clamp(bridge.z, 8 * s + extentZ, maxZ - extentZ);
    const recovery = [land, bridge].filter(valid).sort((a, b) => a.distanceToSquared(desired) - b.distanceToSquared(desired));
    if (recovery.length) return recovery[0];
  }

  // Reach the obstacle, then retain movement parallel to its edge.
  let low = 0, high = 1;
  const stopped = origin.clone();
  if (valid(origin)) {
    for (let i = 0; i < 12; i++) {
      const fraction = (low + high) / 2;
      stopped.lerpVectors(origin, desired, fraction);
      if (valid(stopped)) low = fraction;
      else high = fraction;
    }
    stopped.lerpVectors(origin, desired, low);
  }
  const slideX = new THREE.Vector3(desired.x, next.y, stopped.z);
  const slideZ = new THREE.Vector3(stopped.x, next.y, desired.z);
  const slides = [slideX, slideZ].filter(valid);
  slides.sort((a, b) => b.distanceToSquared(origin) - a.distanceToSquared(origin));
  return slides[0] || stopped;
}
