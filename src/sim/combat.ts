// Kampf: Zielwahl, Trefferchance, Geschosse und Lenkraketen, Panzerung gegen Durchschlag, Unterdrückung.
// Alle Stellschrauben stehen oben. Schaden ist bewusst hart: ein Durchschlag beim Panzer ist meist das Ende.

import type { Category, Weapon } from '../data/units';
import { SIZE, sightDistance } from './vision';
import type { Unit, World } from './world';

type Kind = Weapon['kind'];

// Lebenspunkte je Fahrzeugart; Infanterie hat so viele, wie sie Soldaten hat
export const MAX_HP: Record<Category, number> = { tank: 10, ifv: 6, apc: 5, recon: 3, infantry: 0, at: 0 };

// Grund-Trefferchance auf kurze Entfernung
const BASE_HIT: Record<Kind, number> = { ke: 0.9, atgm: 0.92, heat: 0.6, autocannon: 0.7, mg: 0.6, rifle: 0.5 };
// Trefferchance, wenn der Schütze fährt (Lenkraketen und Panzerfäuste gar nicht)
const MOVING_HIT: Record<Kind, number> = { ke: 0.6, atgm: 0, heat: 0, autocannon: 0.55, mg: 0.45, rifle: 0.35 };
const TARGET_MOVING = 0.8;
// Deckung am Standort des Ziels
const COVER_FOOT: Record<string, number> = { building: 0.4, forest: 0.6, scrub: 0.8, garden: 0.8 };
const COVER_VEHICLE: Record<string, number> = { forest: 0.8 };
// Schaden pro Durchschlag (Fahrzeug-Lebenspunkte) bzw. getötete Soldaten pro Treffer
// (Kanonen schießen auf Infanterie Sprengmunition statt KE)
const DAMAGE: Record<Kind, number> = { ke: 7, atgm: 8, heat: 7, autocannon: 1.2, mg: 0.6, rifle: 0.3 };
const KILLS: Record<Kind, number> = { ke: 1, atgm: 1.2, heat: 1, autocannon: 0.8, mg: 0.6, rifle: 0.4 };
const WEAK_SPOT = { chance: 0.12, armor: 0.45 }; // Wannenbug, Turmring usw.
// Unterdrückung pro Beschuss (Fehlschuss zählt 60 %); Fahrzeugbesatzungen halb so stark, im Haus halb so stark
const SUPPRESS: Record<Kind, number> = { ke: 15, atgm: 20, heat: 15, autocannon: 10, mg: 8, rifle: 4 };
const SUPPRESS_DECAY = 8;    // pro Sekunde, sobald 3 s Ruhe ist
export const PINNED = 70;    // ab hier schießt Infanterie nicht mehr und kriecht nur
const RETREAT = 95;          // ab hier zieht sich Infanterie zurück
const REVEAL: Record<Kind, number> = { ke: 6, atgm: 6, heat: 5, autocannon: 5, mg: 3, rifle: 3 }; // Sekunden sichtbar nach Schuss
const THINK = 0.1;           // so oft wird über Ziele entschieden (Spielsekunden)
const LINE_OF_FIRE_SLACK = 100; // so viel „Sichtkosten“ (Gebüsch, Waldrand) darf zwischen Schütze und Ziel sein

export interface Projectile {
  weapon: Weapon;
  shooter: Unit;
  target: Unit;
  x: number; y: number;   // aktuelle Position
  sx: number; sy: number; // Abschussort
  tx: number; ty: number; // Zielpunkt
  hit: boolean;           // beim Abschuss ausgewürfelt
  dist: number;           // Schussentfernung
}

export interface Impact { x: number; y: number; time: number; kind: 'pen' | 'bounce' | 'miss' | 'kill' | 'muzzle'; shooter?: Unit }
export interface CombatEvent { time: number; text: string; side: 'blue' | 'red' }

export interface WeaponState { cool: number; ammo: number; inFlight: boolean }

export function initCombat(u: Unit) {
  u.maxHp = u.type.mobility === 'foot' ? u.type.men : MAX_HP[u.type.category];
  u.hp = u.maxHp;
  u.supp = 0;
  u.weapons = u.type.weapons.map(w => ({ cool: Math.random() * 2, ammo: w.ammo, inFlight: false }));
}

const isFoot = (u: Unit) => u.type.mobility === 'foot';
export const menLeft = (u: Unit) => Math.max(0, Math.ceil(u.hp - 0.01));

// ---------- Hauptschritt ----------
export function updateCombat(w: World, dt: number) {
  for (const u of w.units) {
    if (u.dead) continue;
    for (const s of u.weapons) s.cool -= dt;
    // Unterdrückung lässt nach
    if (w.time - (u.suppAt ?? -99) > 3) u.supp = Math.max(0, u.supp - SUPPRESS_DECAY * dt);
    if (u.retreating && !u.path.length) u.retreating = false;
  }
  updateProjectiles(w, dt);
  w.combatTimer -= dt;
  if (w.combatTimer > 0) return;
  w.combatTimer = THINK;
  for (const u of w.units) if (!u.dead) think(w, u);
}

// Jede Waffe sucht sich das beste Ziel und schießt, sobald sie geladen ist
function think(w: World, u: Unit) {
  if (isFoot(u) && (u.supp >= PINNED || u.retreating)) return;
  const forced = u.targetId != null ? w.units.find(e => e.id === u.targetId && !e.dead) : undefined;
  if (u.targetId != null && !forced) u.targetId = undefined;
  if (u.holdFire && !forced) return;
  const enemies = w.units.filter(e => e.side !== u.side && !e.dead && e.spotted && (u.duelWith == null || e.id === u.duelWith));
  if (!enemies.length) return;
  const lof = new Map<Unit, boolean>();
  const canFireAt = (e: Unit) => {
    if (!lof.has(e)) {
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      lof.set(e, sightDistance(w.sight, u.x, u.y, e.x, e.y, d + LINE_OF_FIRE_SLACK) <= d + LINE_OF_FIRE_SLACK);
    }
    return lof.get(e)!;
  };
  let engaged = false;
  u.type.weapons.forEach((weapon, i) => {
    const st = u.weapons[i];
    if (st.cool > 0 || st.ammo <= 0 || st.inFlight) return;
    if (u.speed > 0.5 && MOVING_HIT[weapon.kind] === 0) return;
    let best: Unit | undefined, bestScore = 0;
    for (const e of forced ? [forced] : enemies) {
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (d > weapon.range) continue;
      const score = effect(weapon, u, e, d) * priority(e) / (1 + d / 1000);
      if (score > bestScore && canFireAt(e)) { best = e; bestScore = score; }
    }
    if (!best) return;
    engaged = true;
    fire(w, u, i, best);
  });
  // Gegner ohne angreifende KI: wer kämpft, bleibt stehen statt weiter herumzufahren
  if (engaged && u.side === 'red' && u.wandering) { u.path = []; u.wandering = false; u.wanderAt = w.time + 30; }
}

// Wie viel richtet die Waffe gegen dieses Ziel aus (0 = sinnlos)?
function effect(weapon: Weapon, u: Unit, e: Unit, d: number) {
  if (isFoot(e)) {
    if (weapon.kind === 'atgm' || weapon.kind === 'heat') return 0; // keine Panzerabwehrwaffen auf Infanterie
    return KILLS[weapon.kind];
  }
  const armor = e.type.armor[weapon.topAttack ? 'top' : facing(e, u.x, u.y)];
  const pen = penetration(weapon, d);
  const ratio = pen / Math.max(1, armor);
  if (ratio >= 0.9) return DAMAGE[weapon.kind] * Math.min(2, ratio) / e.maxHp;
  // Kommt die Waffe nur über Schwachstellen durch, lohnt es sich trotzdem ein bisschen (Panzer gegen Panzer)
  if (pen / Math.max(1, armor * WEAK_SPOT.armor) >= 1 && weapon.kind !== 'mg') return WEAK_SPOT.chance * DAMAGE[weapon.kind] / e.maxHp;
  return 0;
}

// Gefährliche Ziele zuerst
function priority(e: Unit) {
  const p: Record<Category, number> = { tank: 3, ifv: 2.5, at: 2.5, apc: 1.5, infantry: 1.5, recon: 1.2 };
  return p[e.type.category];
}

function penetration(weapon: Weapon, d: number) {
  return weapon.kind === 'ke' ? weapon.penetration * (1 - 0.05 * d / 1000) : weapon.penetration;
}

// Von welcher Seite trifft es das Ziel?
export function facing(target: Unit, fromX: number, fromY: number): 'front' | 'side' | 'rear' {
  let a = Math.atan2(fromY - target.y, fromX - target.x) - target.heading;
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  const abs = Math.abs(a);
  return abs < Math.PI / 4 ? 'front' : abs > (Math.PI * 3) / 4 ? 'rear' : 'side';
}

export function hitChance(w: World, weapon: Weapon, u: Unit, e: Unit, d: number) {
  const k = weapon.kind;
  let p = BASE_HIT[k];
  p *= k === 'atgm' ? 1 - 0.15 * (d / weapon.range) : 1 - 0.6 * Math.pow(d / weapon.range, 1.5);
  if (u.speed > 0.5) p *= MOVING_HIT[k];
  if (e.speed > 0.5 && k !== 'atgm') p *= TARGET_MOVING;
  p *= 0.45 + 0.55 * SIZE[e.type.category];
  const terrain = w.sight.terrainAt(e.x, e.y);
  p *= (isFoot(e) ? COVER_FOOT[terrain] : COVER_VEHICLE[terrain]) ?? 1;
  p *= 1 - u.supp / 150;
  if (isFoot(u) && (k === 'rifle' || k === 'mg')) p *= Math.max(0.3, u.hp / u.maxHp); // weniger Leute, weniger Feuer
  return p;
}

function fire(w: World, u: Unit, i: number, e: Unit) {
  const weapon = u.type.weapons[i], st = u.weapons[i];
  const d = Math.hypot(e.x - u.x, e.y - u.y);
  st.ammo--;
  st.cool = weapon.reload * (0.9 + Math.random() * 0.2);
  if (weapon.mount) u.type.weapons.forEach((o, j) => { if (o.mount === weapon.mount) u.weapons[j].cool = Math.max(u.weapons[j].cool, st.cool); });
  if (weapon.guided) st.inFlight = true;
  // Wer schießt, verrät sich
  u.revealedUntil = Math.max(u.revealedUntil ?? 0, w.time + REVEAL[weapon.kind]);
  u.lastShot = w.time;
  const hit = Math.random() < hitChance(w, weapon, u, e, d);
  w.projectiles.push({ weapon, shooter: u, target: e, x: u.x, y: u.y, sx: u.x, sy: u.y, tx: e.x, ty: e.y, hit, dist: d });
  w.impacts.push({ x: u.x, y: u.y, time: w.time, kind: 'muzzle', shooter: u });
}

function updateProjectiles(w: World, dt: number) {
  w.projectiles = w.projectiles.filter(p => {
    const { weapon, target } = p;
    // Lenkraketen und Treffer folgen dem Ziel, Fehlschüsse fliegen zum alten Punkt (plus Streuung)
    if ((weapon.guided || p.hit) && !target.dead) { p.tx = target.x; p.ty = target.y; }
    const rest = Math.hypot(p.tx - p.x, p.ty - p.y), step = weapon.speed * dt;
    if (rest > step) { p.x += ((p.tx - p.x) / rest) * step; p.y += ((p.ty - p.y) / rest) * step; return true; }
    land(w, p);
    return false;
  });
}

function land(w: World, p: Projectile) {
  const { weapon, shooter: u, target: e } = p;
  if (weapon.guided) {
    const st = u.weapons[u.type.weapons.indexOf(weapon)];
    st.inFlight = false;
    // Drahtgelenkt bzw. Leitstrahl: der Schütze muss das Ziel bis zum Einschlag im Visier behalten
    if (weapon.guided === 'saclos') {
      const d = Math.hypot(e.x - u.x, e.y - u.y);
      if (u.dead || u.speed > 1 || sightDistance(w.sight, u.x, u.y, e.x, e.y, d + LINE_OF_FIRE_SLACK) > d + LINE_OF_FIRE_SLACK) p.hit = false;
    }
  }
  const terrain = w.sight.terrainAt(e.x, e.y);
  const inHouse = terrain === 'building' && isFoot(e);
  let supp = SUPPRESS[weapon.kind] * (isFoot(e) ? 1 : 0.5) * (inHouse ? 0.5 : 1);
  if (!p.hit || e.dead) {
    const a = Math.random() * Math.PI * 2, r = 5 + Math.random() * 20;
    w.impacts.push({ x: p.tx + Math.cos(a) * r, y: p.ty + Math.sin(a) * r, time: w.time, kind: 'miss' });
    if (!e.dead) suppress(w, e, supp * 0.6);
    return;
  }
  const name = u.type.name, tname = e.type.name;
  if (isFoot(e)) {
    const before = menLeft(e);
    e.hp -= KILLS[weapon.kind] * (0.5 + Math.random()) * (inHouse ? 0.6 : 1);
    const lost = before - menLeft(e);
    w.impacts.push({ x: e.x, y: e.y, time: w.time, kind: 'pen' });
    if (e.hp < 0.5) kill(w, e, `${name} reibt ${tname} auf`);
    else if (lost > 0) w.log(`${tname}: ${lost === 1 ? '1 Soldat' : `${lost} Soldaten`} gefallen (${name})`, e.side);
  } else {
    const side = weapon.topAttack ? 'top' : facing(e, p.sx, p.sy);
    const weak = !weapon.topAttack && Math.random() < WEAK_SPOT.chance;
    const armor = e.type.armor[side] * (weak ? WEAK_SPOT.armor : 1);
    const ratio = penetration(weapon, p.dist) / Math.max(1, armor);
    const sideName = { front: 'vorn', side: 'Seite', rear: 'Heck', top: 'von oben' }[side];
    const heavy = weapon.kind === 'ke' || weapon.kind === 'atgm' || weapon.kind === 'heat';
    if (ratio < 0.9 || (ratio < 1 && Math.random() < 0.5)) {
      w.impacts.push({ x: e.x, y: e.y, time: w.time, kind: 'bounce' });
      if (heavy) w.log(`${name} trifft ${tname} ${sideName} – kein Durchschlag`, e.side);
    } else {
      const dmg = DAMAGE[weapon.kind] * (ratio < 1 ? 0.5 : Math.min(2, ratio)) * (0.7 + Math.random() * 0.6);
      e.hp -= dmg;
      supp *= 2;
      w.impacts.push({ x: e.x, y: e.y, time: w.time, kind: 'pen' });
      if (e.hp <= 0) kill(w, e, `${name} zerstört ${tname} (${weak ? 'Schwachstelle' : sideName})`);
      else if (heavy || e.hp < e.maxHp * 0.5) w.log(`${name} trifft ${tname} ${sideName} – beschädigt`, e.side);
    }
  }
  if (!e.dead) suppress(w, e, supp, p.sx, p.sy);
}

function suppress(w: World, e: Unit, amount: number, fromX?: number, fromY?: number) {
  e.supp = Math.min(100, e.supp + amount);
  e.suppAt = w.time;
  if (fromX != null) e.lastHitFrom = { x: fromX, y: fromY! };
  // Infanterie unter zu starkem Feuer setzt sich ab
  if (isFoot(e) && e.supp >= RETREAT && !e.retreating && e.lastHitFrom) {
    const a = Math.atan2(e.y - e.lastHitFrom.y, e.x - e.lastHitFrom.x);
    w.retreat(e, { x: e.x + Math.cos(a) * 150, y: e.y + Math.sin(a) * 150 });
    w.log(`${e.type.name} zieht sich zurück`, e.side);
  }
}

function kill(w: World, e: Unit, text: string) {
  e.dead = true;
  e.hp = 0;
  e.path = [];
  e.speed = 0;
  w.impacts.push({ x: e.x, y: e.y, time: w.time, kind: 'kill' });
  w.log(text, e.side);
}
