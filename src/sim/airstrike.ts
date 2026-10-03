// Jets: stehen außerhalb der Karte bereit und fliegen auf Befehl vom eigenen Kartenrand ein.
// Über der Karte sind sie steuerbar: zu einem Punkt fliegen und dort kreisen (aufklären), einen Gegner oder Punkt
// bombardieren, zurückkehren. Der Treibstoff reicht für eine begrenzte Zeit, danach kehren sie von selbst um.
// Nach der Landung wird aufmunitioniert. Über der Karte kann die Flugabwehr sie treffen.

import type { Unit, World } from './world';

const JET_SPEED = 150;     // m/s im Spieltempo
const TURN = 0.9;          // rad/s (Kurvenradius ≈ 170 m)
const BOMB_TIME = 2.5;     // Sekunden Fallzeit der Bombe
const REARM = 90;          // Sekunden bis zum nächsten Einsatz
export const FUEL = 75;    // Sekunden über der Karte

export type SortiePhase = 'ready' | 'flying' | 'outbound' | 'rearm';
export interface Sortie {
  phase: SortiePhase;
  tx: number; ty: number;  // Flugziel bzw. Bombenziel
  strike: boolean;         // Bomben auf das Ziel werfen
  targetId?: number;       // Ziel-Einheit, der die Bomben folgen
  autoReturn: boolean;     // nach dem Abwurf sofort heim (KI)
  fuelUntil: number;       // Spielzeit, bis zu der der Treibstoff reicht
  until: number;           // Ende des Aufmunitionierens
}

export const isJet = (u: Unit) => u.type.air === 'jet';

// Jet nach dem Kauf: wartet außerhalb der Karte
export function parkJet(u: Unit) {
  u.offmap = true;
  u.path = [];
  u.sortie = { phase: 'ready', tx: 0, ty: 0, strike: false, autoReturn: false, fuelUntil: 0, until: 0 };
  u.x = -9999; u.y = -9999;
}

// Start: Jet erscheint am eigenen Kartenrand. Mit `strike` greift er das Ziel an, sonst fliegt er hin und kreist.
export function launchJet(w: World, jet: Unit, x: number, y: number, strike: boolean, target?: Unit, autoReturn = false) {
  if (jet.dead || jet.sortie?.phase !== 'ready') return false;
  const blue = jet.side === 'blue';
  jet.offmap = false;
  jet.x = blue ? -120 : w.size + 120;
  jet.y = Math.min(w.size - 50, Math.max(50, y + (Math.random() - 0.5) * 300));
  jet.heading = Math.atan2(y - jet.y, x - jet.x);
  jet.speed = JET_SPEED;
  jet.weapons[0].ammo = jet.type.bombs!.count;
  jet.sortie = { phase: 'flying', tx: x, ty: y, strike, targetId: target?.id, autoReturn, fuelUntil: w.time + FUEL, until: 0 };
  w.log(`${jet.type.name} fliegt an`, jet.side === 'blue' ? 'red' : 'blue', jet.side === 'red');
  return true;
}

// Bisherige Schnittstelle (KI): anfliegen, bombardieren, heim
export function callStrike(w: World, jet: Unit, x: number, y: number, target?: Unit) {
  return launchJet(w, jet, x, y, true, target, true);
}

// Befehle für einen Jet über der Karte
export function jetGoto(jet: Unit, x: number, y: number) {
  const s = jet.sortie;
  if (!s || s.phase !== 'flying') return false;
  s.tx = x; s.ty = y; s.strike = false; s.targetId = undefined;
  return true;
}
export function jetStrike(jet: Unit, x: number, y: number, target?: Unit) {
  const s = jet.sortie;
  if (!s || s.phase !== 'flying' || jet.weapons[0].ammo <= 0) return false;
  s.tx = x; s.ty = y; s.strike = true; s.targetId = target?.id;
  return true;
}
export function jetReturn(jet: Unit) {
  const s = jet.sortie;
  if (!s || s.phase !== 'flying') return false;
  s.phase = 'outbound';
  return true;
}

export function updateJets(w: World, dt: number) {
  for (const u of w.units) {
    const s = u.sortie;
    if (!s || u.dead) continue;
    if (s.phase === 'ready') continue;
    if (s.phase === 'rearm') { if (w.time >= s.until) s.phase = 'ready'; continue; }
    if (s.phase === 'flying' && w.time >= s.fuelUntil) {
      s.phase = 'outbound';
      if (u.side === 'blue') w.log(`${u.type.name}: Treibstoff knapp, kehrt zurück`, 'red', true);
    }
    if (s.phase === 'flying') {
      // Ziel-Einheit verfolgen, solange sie gesehen wird
      const t = s.targetId != null ? w.units.find(e => e.id === s.targetId && !e.dead && e.spotted) : undefined;
      if (t) { s.tx = t.x; s.ty = t.y; }
      const d = Math.hypot(s.tx - u.x, s.ty - u.y);
      const toGoal = Math.atan2(s.ty - u.y, s.tx - u.x);
      if (s.strike) {
        // Anflug aufs Ziel (scharf eindrehen), Abwurf so, dass die Bomben mit der Fallzeit ankommen
        turnTo(u, toGoal, dt * 2);
        if (d <= JET_SPEED * BOMB_TIME && Math.abs(angleDiff(toGoal, u.heading)) < 0.5) {
          dropBombs(w, u, s.tx, s.ty);
          s.strike = false;
          s.targetId = undefined;
          if (s.autoReturn) s.phase = 'outbound';
        }
      } else if (d > 220) {
        turnTo(u, toGoal, dt); // hinfliegen
      } else {
        u.heading += TURN * dt; // über dem Punkt kreisen
      }
    } else {
      // Abdrehen Richtung eigener Kartenrand
      const homeX = u.side === 'blue' ? -500 : w.size + 500;
      turnTo(u, Math.atan2(0, homeX - u.x), dt);
    }
    u.x += Math.cos(u.heading) * JET_SPEED * dt;
    u.y += Math.sin(u.heading) * JET_SPEED * dt;
    // Kurven dürfen kurz über den Rand führen; erst beim Heimflug zählt der Rand als „gelandet“
    if (s.phase === 'outbound' && (u.x < -150 || u.y < -150 || u.x > w.size + 150 || u.y > w.size + 150)) {
      u.offmap = true;
      u.x = -9999; u.y = -9999;
      s.phase = 'rearm';
      s.until = w.time + REARM;
    }
  }
}

function dropBombs(w: World, u: Unit, tx: number, ty: number) {
  const b = u.type.bombs!;
  const n = u.weapons[0].ammo;
  for (let i = 0; i < n; i++) {
    const r = b.spread * Math.sqrt(-2 * Math.log(Math.random() + 1e-9)), a = Math.random() * Math.PI * 2;
    w.shells.push({
      x: tx + Math.cos(a) * r + i * 12 * Math.cos(u.heading), y: ty + Math.sin(a) * r + i * 12 * Math.sin(u.heading),
      sx: u.x, sy: u.y, t: w.time, arrive: w.time + BOMB_TIME + i * 0.3, smoke: false, shooter: u,
      spec: { lethal: b.lethal, topPen: 300, heavy: true },
    });
  }
  u.weapons[0].ammo = 0;
}

function turnTo(u: Unit, want: number, maxTurn: number) {
  const diff = angleDiff(want, u.heading);
  u.heading += Math.max(-TURN * maxTurn, Math.min(TURN * maxTurn, diff));
}

function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
