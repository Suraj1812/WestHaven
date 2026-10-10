/**
 * Bind tap selection without interfering with OrbitControls' pointer capture.
 * onTap receives the original pointerup event; onStart receives pointerdown
 * or wheel events. Returns a function that removes every installed listener.
 */
export function bindCanvasSelection(canvas, onTap, onStart = () => {}) {
  const pointers = new Map();
  const options = { passive: true };
  const thresholdSquared = 7 * 7;
  let multiTouch = false;

  function clear() {
    pointers.clear();
    multiTouch = false;
  }

  function remember(event, eligible) {
    if (pointers.has(event.pointerId)) return;
    if (pointers.size) multiTouch = true;
    else multiTouch = false;
    pointers.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
      moved: false,
      eligible,
    });
  }

  function start(event) {
    remember(event, event.button === 0 && event.isPrimary !== false);
    onStart(event);
  }

  function outsideStart(event) {
    // A second finger outside the canvas still invalidates the canvas tap.
    if (pointers.size && !pointers.has(event.pointerId)) remember(event, false);
  }

  function move(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    const dx = event.clientX - pointer.x;
    const dy = event.clientY - pointer.y;
    if (dx * dx + dy * dy > thresholdSquared) pointer.moved = true;
  }

  function end(event) {
    const pointer = pointers.get(event.pointerId);
    if (!pointer) return;
    move(event);
    const rect = canvas.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right
      && event.clientY >= rect.top && event.clientY <= rect.bottom;
    const tap = pointer.eligible && !pointer.moved && !multiTouch
      && event.button === 0 && inside;
    pointers.delete(event.pointerId);
    if (!pointers.size) multiTouch = false;
    if (tap) onTap(event);
  }

  function cancel(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    // Keep a canceled multi-pointer gesture invalid until all fingers leave.
    if (pointers.size) multiTouch = true;
    else multiTouch = false;
  }

  function wheel(event) { onStart(event); }
  function visibility() { if (document.hidden) clear(); }

  canvas.addEventListener('pointerdown', start, options);
  canvas.addEventListener('wheel', wheel, options);
  // Window sees bubbled events even when OrbitControls captures the pointer.
  // No additional setPointerCapture/releasePointerCapture calls are needed.
  window.addEventListener('pointerdown', outsideStart, options);
  window.addEventListener('pointermove', move, options);
  window.addEventListener('pointerup', end, options);
  window.addEventListener('pointercancel', cancel, options);
  window.addEventListener('blur', clear);
  document.addEventListener('visibilitychange', visibility);

  return () => {
    canvas.removeEventListener('pointerdown', start, options);
    canvas.removeEventListener('wheel', wheel, options);
    window.removeEventListener('pointerdown', outsideStart, options);
    window.removeEventListener('pointermove', move, options);
    window.removeEventListener('pointerup', end, options);
    window.removeEventListener('pointercancel', cancel, options);
    window.removeEventListener('blur', clear);
    document.removeEventListener('visibilitychange', visibility);
    clear();
  };
}
