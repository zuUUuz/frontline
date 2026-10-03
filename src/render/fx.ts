// Gefechtseffekte, bewusst schlicht (schöner wird es in Schritt 11): Leuchtspur, Lenkraketen, Einschläge.

import type { Graphics } from 'pixi.js';
import type { World } from '../sim/world';

const TRACER: Record<string, number> = { ke: 0xffffff, autocannon: 0xffd24a, mg: 0xffe58a, rifle: 0xfff3c0, heat: 0xffa040, atgm: 0xff7a2a };

export function drawFx(g: Graphics, w: World, scale: number, revealAll: boolean) {
  g.clear();
  const px = 1 / scale; // ein Bildschirmpixel in Metern
  for (const p of w.projectiles) {
    const k = p.weapon.kind, color = TRACER[k];
    const back = Math.hypot(p.x - p.sx, p.y - p.sy);
    if (back < 1) continue;
    const dx = (p.x - p.sx) / back, dy = (p.y - p.sy) / back;
    if (p.weapon.guided) {
      // Eigene Lenkraketen mit Flugbahn, gegnerische nur als Punkt (verrät sonst den Schützen)
      if (p.shooter.side === 'blue' || p.shooter.spotted || revealAll) g.moveTo(p.sx, p.sy).lineTo(p.x, p.y).stroke({ width: px, color, alpha: 0.35 });
      g.moveTo(p.x - dx * Math.min(back, 25), p.y - dy * Math.min(back, 25)).lineTo(p.x, p.y).stroke({ width: 2 * px, color: 0xd8d8d0, alpha: 0.6 });
      g.circle(p.x, p.y, 3 * px).fill(color);
    } else {
      const len = Math.min(back, k === 'ke' ? 60 : 30);
      g.moveTo(p.x - dx * len, p.y - dy * len).lineTo(p.x, p.y).stroke({ width: (k === 'ke' ? 2 : 1.5) * px, color, alpha: 0.95 });
    }
  }
  for (const i of w.impacts) {
    const age = w.time - i.time;
    switch (i.kind) {
      case 'muzzle': {
        if (age > 0.15) break;
        const u = i.shooter;
        if (u && u.side === 'red' && !u.spotted && !revealAll) break;
        g.circle(i.x, i.y, 4 * px).fill({ color: 0xfff2b0, alpha: 0.9 });
        break;
      }
      case 'miss':
        if (age < 0.6) g.circle(i.x, i.y, 2 + age * 8).fill({ color: 0x8a7a5a, alpha: 0.6 * (1 - age / 0.6) });
        break;
      case 'bounce':
        if (age < 0.4) g.circle(i.x, i.y, Math.max(2, 4 * px)).fill({ color: 0xffee88, alpha: 1 - age / 0.4 });
        break;
      case 'pen':
        if (age < 0.8) g.circle(i.x, i.y, Math.max(3, 5 * px) * (1 + age)).fill({ color: 0xff8a2a, alpha: 0.9 * (1 - age / 0.8) });
        break;
      case 'kill':
        g.circle(i.x, i.y, 4 + age * 10).fill({ color: 0x2a2622, alpha: 0.5 * (1 - age / 1.5) });
        g.circle(i.x, i.y, 3 + age * 14).stroke({ width: 3 * px, color: 0xff5a1f, alpha: 1 - age / 1.5 });
        break;
    }
  }
}
