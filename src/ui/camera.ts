// Kamera: Verschieben mit einem Finger, Zoomen mit zwei Fingern oder dem Mausrad. Ein kurzer Tipp meldet
// die angetippte Stelle in Metern.

import type { Container } from 'pixi.js';

export interface Camera {
  scale: number; // Bildschirmpixel pro Meter
  enabled: boolean; // false, solange z. B. ein Auswahlrahmen gezogen wird
  fit: () => void;
  centerOn: (x: number, y: number, scale?: number) => void;
  toWorld: (sx: number, sy: number) => { x: number; y: number };
  onChange?: () => void;
  onTap?: (x: number, y: number) => void;
}

const MAX_SCALE = 6; // nah: ein 10-m-Panzer ist dann 60 Pixel lang

export function createCamera(el: HTMLElement, world: Container, worldSize: number): Camera {
  const cam: Camera = { scale: 1, enabled: true, fit, centerOn, toWorld };
  let x = 0, y = 0; // Bildschirmposition des Kartenursprungs
  const pointers = new Map<number, { x: number; y: number }>();
  let tapStart: { x: number; y: number; t: number } | null = null;
  let pinchDist = 0;

  const minScale = () => Math.min(el.clientWidth, el.clientHeight) / worldSize * 0.9;

  function apply() {
    // Karte nicht ganz aus dem Bild schieben: Mitte des Bildschirms bleibt über der Karte
    const w = el.clientWidth, h = el.clientHeight, size = worldSize * cam.scale;
    x = Math.min(w / 2, Math.max(w / 2 - size, x));
    y = Math.min(h / 2, Math.max(h / 2 - size, y));
    world.position.set(x, y);
    world.scale.set(cam.scale);
    cam.onChange?.();
  }

  function zoomAt(sx: number, sy: number, factor: number) {
    const next = Math.min(MAX_SCALE, Math.max(minScale(), cam.scale * factor));
    const k = next / cam.scale;
    x = sx - (sx - x) * k;
    y = sy - (sy - y) * k;
    cam.scale = next;
    apply();
  }

  function fit() {
    cam.scale = minScale();
    x = (el.clientWidth - worldSize * cam.scale) / 2;
    y = (el.clientHeight - worldSize * cam.scale) / 2;
    apply();
  }

  function centerOn(wx: number, wy: number, scale = cam.scale) {
    cam.scale = Math.min(MAX_SCALE, Math.max(minScale(), scale));
    x = el.clientWidth / 2 - wx * cam.scale;
    y = el.clientHeight / 2 - wy * cam.scale;
    apply();
  }

  function toWorld(sx: number, sy: number) {
    return { x: (sx - x) / cam.scale, y: (sy - y) / cam.scale };
  }

  const local = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  el.addEventListener('pointerdown', e => {
    if (!cam.enabled) return;
    el.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    tapStart = pointers.size === 1 ? { ...p, t: performance.now() } : null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  el.addEventListener('pointermove', e => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 1) {
      x += p.x - prev.x;
      y += p.y - prev.y;
      apply();
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      // Mitte mitziehen (gleichzeitig verschieben und zoomen)
      x += (p.x - prev.x) / 2;
      y += (p.y - prev.y) / 2;
      if (pinchDist > 0) zoomAt(mid.x, mid.y, dist / pinchDist);
      pinchDist = dist;
    }
  });

  const end = (e: PointerEvent) => {
    const p = local(e);
    if (tapStart && pointers.size === 1 && Math.hypot(p.x - tapStart.x, p.y - tapStart.y) < 8 && performance.now() - tapStart.t < 350) {
      const w = toWorld(p.x, p.y);
      cam.onTap?.(w.x, w.y);
    }
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    tapStart = null;
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);

  el.addEventListener('wheel', e => {
    e.preventDefault();
    const r = el.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  window.addEventListener('resize', () => apply());
  return cam;
}
