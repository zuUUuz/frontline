// Jets: stehen außerhalb der Karte bereit, fliegen auf Befehl vom eigenen Kartenrand ein, werfen ihre Lenkbomben
// auf Punkt oder Einheit, drehen ab und müssen danach aufmunitionieren. Über der Karte kann die Flugabwehr sie treffen.

import type { Unit, World } from './world';

const JET_SPEED = 150;     // m/s im Spieltempo
const TURN = 0.9;          // rad/s beim Abdrehen
const BOMB_TIME = 2.5;     // Sekunden Fallzeit der Bombe
const REARM = 90;          // Sekunden bis zum nächsten Einsatz

export type SortiePhase = 'ready' | 'inbound' | 'outbound' | 'rearm';
export interface Sortie { phase: SortiePhase; tx: number; ty: number; targetId?: number; until: number }

export const isJet = (u: Unit) => u.type.air === 'jet';

// Jet nach dem Kauf: wartet außerhalb der Karte
export function parkJet(u: Unit) {
  u.offmap = true;
  u.path = [];
  u.sortie = { phase: 'ready', tx: 0, ty: 0, until: 0 };
  u.x = -9999; u.y = -9999;
}

// Einsatz befehlen: Ziel ist ein Punkt oder eine (gesehene) Einheit, der die Bombe dann folgt
export function callStrike(w: World, jet: Unit, x: number, y: number, target?: Unit) {
  if (jet.dead || jet.sortie?.phase !== 'ready') return false;
  const blue = jet.side === 'blue';
  jet.offmap = false;
  jet.x = blue ? -120 : w.size + 120;
  jet.y = Math.min(w.size - 50, Math.max(50, y + (Math.random() - 0.5) * 300));
  jet.heading = Math.atan2(y - jet.y, x - jet.x);
  jet.speed = JET_SPEED;
  jet.weapons[0].ammo = jet.type.bombs!.count;
  jet.sortie = { phase: 'inbound', tx: x, ty: y, targetId: target?.id, until: 0 };
  w.log(`${jet.type.name} fliegt an`, jet.side === 'blue' ? 'red' : 'blue', jet.side === 'red');
  return true;
}

export function updateJets(w: World, dt: number) {
  for (const u of w.units) {
    const s = u.sortie;
    if (!s || u.dead) continue;
    if (s.phase === 'ready') continue;
    if (s.phase === 'rearm') { if (w.time >= s.until) s.phase = 'ready'; continue; }
    if (s.phase === 'inbound') {
      // Ziel-Einheit verfolgen, solange sie gesehen wird
      const t = s.targetId != null ? w.units.find(e => e.id === s.targetId && !e.dead && e.spotted) : undefined;
      if (t) { s.tx = t.x; s.ty = t.y; }
      u.heading = Math.atan2(s.ty - u.y, s.tx - u.x);
      const d = Math.hypot(s.tx - u.x, s.ty - u.y);
      // Abwurf so, dass die Bomben mit der Fallzeit am Ziel ankommen
      if (d <= JET_SPEED * BOMB_TIME) {
        const b = u.type.bombs!;
        for (let i = 0; i < b.count; i++) {
          const r = b.spread * Math.sqrt(-2 * Math.log(Math.random() + 1e-9)), a = Math.random() * Math.PI * 2;
          w.shells.push({
            x: s.tx + Math.cos(a) * r + i * 12 * Math.cos(u.heading), y: s.ty + Math.sin(a) * r + i * 12 * Math.sin(u.heading),
            sx: u.x, sy: u.y, t: w.time, arrive: w.time + BOMB_TIME + i * 0.3, smoke: false, shooter: u,
            spec: { lethal: b.lethal, topPen: 300, heavy: true },
          });
        }
        u.weapons[0].ammo = 0;
        s.phase = 'outbound';
      }
    } else {
      // Abdrehen Richtung eigener Kartenrand
      const homeX = u.side === 'blue' ? -500 : w.size + 500;
      const diff = angleDiff(Math.atan2(0, homeX - u.x), u.heading);
      u.heading += Math.max(-TURN * dt, Math.min(TURN * dt, diff));
    }
    u.x += Math.cos(u.heading) * JET_SPEED * dt;
    u.y += Math.sin(u.heading) * JET_SPEED * dt;
    if (s.phase === 'outbound' && (u.x < -150 || u.y < -150 || u.x > w.size + 150 || u.y > w.size + 150)) {
      u.offmap = true;
      u.x = -9999; u.y = -9999;
      s.phase = 'rearm';
      s.until = w.time + REARM;
    }
  }
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
