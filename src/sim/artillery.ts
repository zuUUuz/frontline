// Artillerie: Feueraufträge (Spreng oder Rauch) auf einen Punkt, ohne Sichtlinie.
// Granaten streuen, Spreng wirkt im Umkreis (Infanterie und leichte Fahrzeuge), Rauch blockiert die Sicht.
// Wer schießt, wird vom Gegner geortet (Gegenbatterie-Radar).

import type { Unit, World } from './world';
import { PINNED } from './combat';

const SETUP = 4;            // Sekunden, bis ein Geschütz nach dem Anhalten feuert
const SMOKE_RADIUS = 40;    // m
const SMOKE_TIME = 55;      // s
const REVEAL = 10;          // s geortet nach jedem Schuss
const BLAST_SUPPRESS = 70;  // Unterdrückung bei Einschlag direkt daneben

export interface Mission { x: number; y: number; smoke: boolean; left: number; next: number }
export interface Shell {
  x: number; y: number; sx: number; sy: number; t: number; arrive: number; smoke: boolean; shooter: Unit;
  spec?: { lethal: number; topPen: number; heavy?: boolean }; // Bomben statt Granaten
}

export const isArtillery = (u: Unit) => !!u.type.artillery;

// Feuerauftrag erteilen; liefert, wie viele Geschütze ihn annehmen
export function orderFire(w: World, units: Unit[], x: number, y: number, smoke: boolean) {
  let n = 0;
  for (const u of units) {
    const a = u.type.artillery;
    if (!a || u.dead) continue;
    if (Math.hypot(x - u.x, y - u.y) < a.minRange) continue;
    if (smoke ? u.smokeAmmo <= 0 : u.weapons[0].ammo <= 0) continue;
    u.path = [];
    u.mission = { x, y, smoke, left: smoke ? Math.min(4, u.smokeAmmo) : a.rounds, next: SETUP };
    n++;
  }
  return n;
}

export function updateArtillery(w: World, dt: number) {
  // Rauch verzieht sich
  w.sight.smoke = w.sight.smoke.filter(s => s.until > w.time);
  for (const u of w.units) {
    const m = u.mission, a = u.type.artillery;
    if (!m || !a || u.dead) continue;
    if (u.path.length || u.speed > 0.5) { m.next = Math.max(m.next, SETUP); continue; } // fährt: erst anhalten und einrichten
    m.next -= dt;
    if (m.next > 0) continue;
    const ammo = m.smoke ? u.smokeAmmo : u.weapons[0].ammo;
    if (m.left <= 0 || ammo <= 0) { u.mission = undefined; continue; }
    // Schuss: Streuung um den Zielpunkt (normalverteilt), Flugzeit nach Entfernung
    const r = a.spread * Math.sqrt(-2 * Math.log(Math.random() + 1e-9)), ang = Math.random() * Math.PI * 2;
    const tx = m.x + Math.cos(ang) * r, ty = m.y + Math.sin(ang) * r;
    const d = Math.hypot(tx - u.x, ty - u.y);
    w.shells.push({ x: tx, y: ty, sx: u.x, sy: u.y, t: w.time, arrive: w.time + 3 + d / a.shellSpeed, smoke: m.smoke, shooter: u });
    if (m.smoke) u.smokeAmmo--; else u.weapons[0].ammo--;
    m.left--;
    m.next = a.interval;
    w.impacts.push({ x: u.x, y: u.y, time: w.time, kind: 'muzzle', shooter: u });
    // Gegenbatterie-Radar: der Gegner kennt jetzt diese Stellung
    if (!u.lastSeen || w.time - u.lastSeen.time > 20) w.log(`${u.side === 'red' ? 'Feindliche' : 'Eigene'} Artillerie geortet: ${u.type.name}`, u.side === 'red' ? 'red' : 'blue', true);
    u.lastSeen = { x: u.x, y: u.y, time: w.time };
    u.revealedUntil = Math.max(u.revealedUntil ?? 0, w.time + REVEAL);
  }
  // Einschläge
  w.shells = w.shells.filter(s => {
    if (w.time < s.arrive) return true;
    if (s.smoke) {
      w.sight.smoke.push({ x: s.x, y: s.y, r: SMOKE_RADIUS, until: w.time + SMOKE_TIME });
      w.impacts.push({ x: s.x, y: s.y, time: w.time, kind: 'miss' });
    } else blast(w, s);
    return false;
  });
}

function blast(w: World, s: Shell) {
  const a = s.spec ?? s.shooter.type.artillery!;
  w.impacts.push({ x: s.x, y: s.y, time: w.time, kind: 'blast' });
  const reach = a.lethal * 4;
  for (const u of w.units) {
    if (u.dead || u.carrier || u.type.air) continue;
    const d = Math.hypot(u.x - s.x, u.y - s.y);
    if (d > reach) continue;
    const terrain = w.sight.terrainAt(u.x, u.y);
    if (u.type.mobility === 'foot') {
      // Jeder Soldat einzeln: im Haus viel geschützter, im Wald kaum (Baumkrepierer)
      const cover = terrain === 'building' ? 0.25 : terrain === 'forest' ? 0.9 : terrain === 'garden' || terrain === 'scrub' ? 0.8 : 1;
      const p = Math.max(0, 0.6 * (1 - d / (a.lethal * 1.6))) * cover * (u.supp >= PINNED ? 0.6 : 1); // wer liegt, ist sicherer
      const men = Math.ceil(u.hp - 0.01);
      let lost = 0;
      for (let k = 0; k < men; k++) if (Math.random() < p) lost++;
      if (lost) {
        u.hp -= lost;
        w.log(`${u.type.name}: ${lost === 1 ? '1 Soldat' : `${lost} Soldaten`} durch Artillerie gefallen`, u.side, u.hp < 0.5);
      }
    } else {
      // Fahrzeuge: Volltreffer schlägt durchs Dach, Splitter reichen nur gegen dünne Panzerung
      let dmg = 0;
      if (d < 3 && a.topPen >= u.type.armor.top) dmg = (s.spec?.heavy ? 12 : 6) * (0.7 + Math.random() * 0.6);
      else if (s.spec?.heavy && d < a.lethal * 0.4) dmg = 14 * (1 - d / (a.lethal * 0.4));     // Druckwelle einer Bombe
      else if (d < a.lethal && u.type.armor.side <= 20) dmg = 3 * (1 - d / a.lethal);      // Splitter durch dünne Panzerung
      else if (d < 6) dmg = 0.8 * (1 - d / 6);                                              // Ketten, Optik, Anbauteile
      if (dmg > 0) {
        u.hp -= dmg;
        if (u.hp > 0) w.log(`${u.type.name} durch Artillerie beschädigt`, u.side);
      }
    }
    if (u.hp < 0.5 || (u.type.mobility !== 'foot' && u.hp <= 0)) {
      u.dead = true; u.hp = 0; u.path = []; u.speed = 0;
      w.impacts.push({ x: u.x, y: u.y, time: w.time, kind: 'kill' });
      const by = s.spec ? s.shooter.type.name : 'Artillerie';
      w.log(`${by} ${u.type.mobility === 'foot' ? 'reibt' : 'zerstört'} ${u.type.name}${u.type.mobility === 'foot' ? ' auf' : ''}`, u.side, true);
      if (u.cargo.length) w.ejectCargo(u);
      continue;
    }
    u.supp = Math.min(100, u.supp + BLAST_SUPPRESS * (1 - d / reach) * (u.type.mobility === 'foot' ? 1 : 0.5));
    u.suppAt = w.time;
    u.lastHitFrom = { x: s.sx, y: s.sy };
  }
}
