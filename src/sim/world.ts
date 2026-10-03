// Spielwelt: Einheiten, ihre Befehle und die Bewegung über das Gelände.

import { UnitType, unitType } from '../data/units';
import { NavGrid, NAV_CELL, findPath, freeAt, nearestPassable, segmentFree, speedAt } from './nav';
import { SightGrid, canSpot, sightDistance } from './vision';
import { CombatEvent, Impact, PINNED, Projectile, WeaponState, initCombat, updateCombat } from './combat';
import { Mission, Shell, updateArtillery } from './artillery';

export type Side = 'blue' | 'red'; // blau = eigene Seite, rot = Gegner

export interface Unit {
  id: number;
  type: UnitType;
  side: Side;
  x: number;
  y: number;
  heading: number;       // Blickrichtung in Radiant (0 = nach rechts/Osten)
  path: { x: number; y: number }[];
  fast: boolean;         // „Schnell bewegen“
  speed: number;         // aktuelle Geschwindigkeit in m/s (für Anzeige)
  stuck: number;         // Sekunden, die die Einheit trotz Weg nicht vorankommt
  lastRepath?: { x: number; y: number }; // Ort der letzten Notfall-Neuplanung
  watch?: { x: number; y: number; t: number }; // Wächter: wo die Einheit zuletzt wirklich vorankam
  spotted: boolean;      // nur Gegner: gerade von einer eigenen Einheit gesehen
  lastSeen?: { x: number; y: number; time: number }; // nur Gegner: letzte bekannte Position (Spielzeit in s)
  wanderAt?: number;     // nur Gegner im Testmodus: wann der nächste Bewegungsbefehl kommt
  wandering?: boolean;   // fährt gerade im Testmodus herum (nicht auf Befehl)
  // ---------- Kampf ----------
  hp: number;            // Lebenspunkte (Infanterie: Soldaten)
  maxHp: number;
  dead?: boolean;        // zerstört bzw. aufgerieben (bleibt als Wrack liegen)
  supp: number;          // Unterdrückung 0..100
  suppAt?: number;       // Spielzeit des letzten Beschusses
  weapons: WeaponState[]; // Nachladen und Munition je Waffe
  holdFire?: boolean;    // „Feuer halten“: schießt nur auf befohlenes Ziel
  targetId?: number;     // befohlenes Ziel
  duelWith?: number;     // Schießstand: schießt nur auf diesen Gegner
  revealedUntil?: number; // hat geschossen und ist bis dahin für den Gegner sichtbar
  lastHitFrom?: { x: number; y: number };
  retreating?: boolean;
  lastShot?: number;     // Spielzeit des letzten eigenen Schusses
  ambush?: boolean;      // liegt im Hinterhalt: schießt erst, wenn der Gegner nah ist (KI)
  // ---------- Transport ----------
  carrier?: Unit;        // sitzt in diesem Fahrzeug (unsichtbar, kann nicht schießen und nicht beschossen werden)
  cargo: Unit[];         // wer in diesem Fahrzeug sitzt
  dismountPending?: boolean; // absitzen, sobald das Fahrzeug steht
  mountTarget?: number;  // Infanterie läuft zu diesem Fahrzeug und steigt ein
  // ---------- Artillerie ----------
  mission?: Mission;     // laufender Feuerauftrag
  smokeAmmo: number;     // Rauchgranaten
}

const SPOT_INTERVAL = 0.25; // so oft (Spielsekunden) wird neu geprüft, wer wen sieht
const WANDER = { radius: 350, pauseMin: 25, pauseMax: 60 }; // Testbewegung der Gegner

// ---------- Stellschrauben fürs Fahrgefühl ----------
// Spieltempo statt Echtzeit-Tempo: im Gelände Fahrzeuge gedrosselt und Infanterie schneller, damit beides
// auf 2 km zusammenpasst; auf der Straße fahren Fahrzeuge nahe an ihrem echten Tempo
const GAME_SPEED = { tracked: 0.5, wheeled: 0.45, foot: 2.7 };
const ROAD_SPEED = { tracked: 0.75, wheeled: 0.85, foot: 2.7 };
// Normales Bewegen ist vorsichtiger als „Schnell“ (Infanterie geht statt zu rennen)
const CAUTIOUS = { tracked: 0.65, wheeled: 0.65, foot: 0.6 };
// Drehgeschwindigkeit in Grad pro Sekunde; Kettenfahrzeuge drehen auf der Stelle, Radfahrzeuge lenken
const TURN_RATE = { tracked: 45, wheeled: 35, foot: 240 };
// Beschleunigung und Bremsen in m/s²
const ACCEL = { tracked: 2.4, wheeled: 4, foot: 3 };
// Ziel gilt als erreicht innerhalb dieser Entfernung
const ARRIVE = 2;
// Die Einheit zielt auf einen Punkt so weit voraus auf ihrem Weg (fährt dadurch Kurven statt Ecken)
const LOOKAHEAD = { tracked: 9, wheeled: 11, foot: 3 };
// Ab diesem Winkel drehen Kettenfahrzeuge auf der Stelle statt im Bogen
const PIVOT_ANGLE = 1.4;

export class World {
  units: Unit[] = [];
  time = 0; // Spielzeit in Sekunden
  wander = true; // Gegner bewegen sich zum Testen auf eigene Faust
  projectiles: Projectile[] = [];
  shells: Shell[] = [];   // Artilleriegranaten im Flug
  impacts: Impact[] = [];
  events: CombatEvent[] = [];
  combatTimer = 0;
  private nextId = 1;
  private spotTimer = 0;

  constructor(readonly nav: NavGrid, readonly size: number, readonly sight: SightGrid) {}

  spawn(typeId: string, side: Side, x: number, y: number, heading = 0) {
    const type = unitType(typeId);
    const p = nearestPassable(this.nav, type.mobility, x, y) ?? { x, y };
    const unit = { id: this.nextId++, type, side, x: p.x, y: p.y, heading, path: [], fast: false, speed: 0, stuck: 0, spotted: false, cargo: [] } as unknown as Unit;
    initCombat(unit);
    this.units.push(unit);
    return unit;
  }

  // Bewegungsbefehl für eine Gruppe: Ziele nebeneinander quer zur Marschrichtung
  // Alles abräumen (Schießstand, neues Gefecht)
  reset() {
    this.units = [];
    this.projectiles = [];
    this.shells = [];
    this.sight.smoke = [];
    this.impacts = [];
    this.events = [];
  }

  // major: wichtige Meldung (Verlust, Sektorwechsel, Rückzug) – nur die erscheinen im Spiel
  log(text: string, side: Side, major = false) {
    this.events.push({ time: this.time, text, side, major });
    if (this.events.length > 40) this.events.shift();
  }

  // Ziel vorgeben: diese Einheiten schießen zuerst darauf (auch bei „Feuer halten“)
  attack(units: Unit[], target: Unit) {
    for (const u of units) u.targetId = target.id;
  }

  // ---------- Transport ----------
  freeSeats(c: Unit) {
    return (c.type.transport ?? 0) - c.cargo.reduce((s, p) => s + Math.ceil(p.hp), 0);
  }

  // Infanterie steigt ein (muss nah dran sein)
  mount(p: Unit, c: Unit) {
    if (p.dead || c.dead || p.carrier || p.type.mobility !== 'foot' || this.freeSeats(c) < Math.ceil(p.hp)) return false;
    p.carrier = c;
    c.cargo.push(p);
    p.path = []; p.speed = 0; p.mountTarget = undefined; p.targetId = undefined; p.retreating = false;
    p.x = c.x; p.y = c.y;
    return true;
  }

  // Alle steigen hinter dem Fahrzeug aus
  dismount(c: Unit) {
    const out = c.cargo;
    c.cargo = [];
    c.dismountPending = false;
    out.forEach((p, i) => {
      p.carrier = undefined;
      const back = c.heading + Math.PI + (i - (out.length - 1) / 2) * 0.6;
      const q = nearestPassable(this.nav, 'foot', c.x + Math.cos(back) * 8, c.y + Math.sin(back) * 8) ?? { x: c.x, y: c.y };
      p.x = q.x; p.y = q.y; p.heading = c.heading;
    });
    return out;
  }

  // Befehl „Aufsitzen“: Infanterie läuft zum Fahrzeug
  boardOrder(units: Unit[], c: Unit) {
    for (const p of units) {
      if (p.type.mobility !== 'foot' || p.carrier) continue;
      this.order([p], c, true);
      p.mountTarget = c.id;
    }
  }

  // Fahrzeug zerstört: die Insassen trifft es hart, Überlebende springen niedergehalten heraus
  ejectCargo(c: Unit) {
    const out = this.dismount(c);
    for (const p of out) {
      let alive = 0;
      for (let m = 0; m < Math.ceil(p.hp); m++) if (Math.random() < 0.45) alive++;
      p.hp = alive;
      p.supp = 95; p.suppAt = this.time;
      if (alive === 0) { p.dead = true; this.log(`${p.type.name} im ${c.type.name} gefallen`, p.side, true); }
      else this.log(`${p.type.name}: ${alive} überleben die Zerstörung des ${c.type.name}`, p.side, true);
    }
    return out;
  }

  // Rückzug: schnell weg von der Gefahr
  retreat(u: Unit, to: { x: number; y: number }) {
    this.order([u], to, true);
    u.retreating = true;
    u.targetId = undefined;
  }

  order(units: Unit[], target: { x: number; y: number }, fast: boolean, danger?: Float32Array) {
    units = units.filter(u => !u.dead && !u.carrier);
    if (!units.length) return;
    const cx = units.reduce((s, u) => s + u.x, 0) / units.length;
    const cy = units.reduce((s, u) => s + u.y, 0) / units.length;
    const dir = Math.atan2(target.y - cy, target.x - cx);
    const px = -Math.sin(dir), py = Math.cos(dir); // quer zur Marschrichtung
    // Nach Lage quer zur Richtung sortieren, damit sich die Wege nicht kreuzen
    const sorted = [...units].sort((a, b) => (a.x - cx) * px + (a.y - cy) * py - ((b.x - cx) * px + (b.y - cy) * py));
    sorted.forEach((u, i) => {
      const spacing = u.type.mobility === 'foot' ? 20 : 35;
      const offset = (i - (sorted.length - 1) / 2) * spacing;
      const goal = { x: clamp(target.x + px * offset, 0, this.size), y: clamp(target.y + py * offset, 0, this.size) };
      const path = findPath(this.nav, u, goal, { mobility: u.type.mobility, preferRoads: fast, danger }) ?? [];
      // Wegpunkte direkt bei der Einheit weglassen, sonst dreht sie erst einmal um
      while (path.length > 1 && Math.hypot(path[0].x - u.x, path[0].y - u.y) < 12) path.shift();
      u.path = path;
      u.fast = fast;
      u.wandering = false;
      u.retreating = false;
      u.mountTarget = undefined; // neuer Befehl ersetzt „Aufsitzen“
      u.mission = undefined;     // … und einen Feuerauftrag
    });
  }

  stop(units: Unit[]) {
    for (const u of units) u.path = [];
  }

  update(dt: number) {
    this.time += dt;
    this.spotTimer -= dt;
    if (this.spotTimer <= 0) { this.spotTimer = SPOT_INTERVAL; this.updateSpotting(); }
    if (this.wander) this.wanderEnemies();
    updateCombat(this, dt);
    updateArtillery(this, dt);
    this.impacts = this.impacts.filter(i => this.time - i.time < 1.5);
    this.updateTransport();
    for (const u of this.units) {
      if (u.dead || u.carrier) continue;
      const mob = u.type.mobility;
      let want = 0; // gewünschte Geschwindigkeit in m/s
      // Erreichte Wegpunkte abhaken: alle, die näher als der Vorausblick liegen (außer dem Ziel)
      // … aber nur, wenn der Punkt danach in gerader Linie frei erreichbar ist
      while (u.path.length > 1 && Math.hypot(u.path[0].x - u.x, u.path[0].y - u.y) < LOOKAHEAD[mob] && segmentFree(this.nav, mob, u, u.path[1])) u.path.shift();
      const goal = u.path[u.path.length - 1];
      if (goal && u.path.length === 1 && Math.hypot(goal.x - u.x, goal.y - u.y) < ARRIVE) u.path.shift();
      if (u.path.length) {
        const aim = this.aimPoint(u);
        const dist = Math.hypot(aim.x - u.x, aim.y - u.y);
        const diff = angleDiff(Math.atan2(aim.y - u.y, aim.x - u.x), u.heading);
        const turn = (TURN_RATE[mob] * Math.PI) / 180;
        u.heading += Math.max(-turn * dt, Math.min(turn * dt, diff));
        want = this.cruise(u);
        // Kettenfahrzeuge drehen bei großem Winkel auf der Stelle; festhängende Radfahrzeuge rangieren genauso
        if (mob === 'tracked' && Math.abs(diff) > PIVOT_ANGLE) want = 0;
        // Festhängende Radfahrzeuge rangieren: langsam kriechend eindrehen (nie ganz stehen, sonst verklemmt es)
        else if (mob === 'wheeled' && u.stuck > 0.4 && Math.abs(diff) > PIVOT_ANGLE * 0.5) want = 0.4;
        else if (mob === 'wheeled') {
          want *= Math.max(0.25, Math.cos(diff));                                       // im Bogen langsamer
          // Punkt liegt näher als der Wendekreis und quer: fast im Stand eng eindrehen statt zu kreisen
          if (Math.abs(diff) > 0.9 && dist < 6) want = Math.min(want, 0.4);
        }
        else want *= Math.max(mob === 'foot' ? 0 : 0.2, Math.cos(diff));
        // Vor dem Ziel abbremsen
        const toGoal = Math.hypot(goal.x - u.x, goal.y - u.y);
        want = Math.min(want, Math.sqrt(2 * ACCEL[mob] * toGoal) + 0.5);
        if (dist < 0.5) want = 0;
      }
      // Beschleunigen bzw. bremsen
      const a = ACCEL[mob] * dt;
      u.speed = want > u.speed ? Math.min(want, u.speed + a) : Math.max(want, u.speed - a * 2);
      const progress = this.moveBy(u, Math.cos(u.heading) * u.speed * dt, Math.sin(u.heading) * u.speed * dt);
      // Notfall: schafft die Einheit trotz Weg kaum etwas von der gewollten Strecke, Weg von hier aus neu planen
      if (u.path.length && want > 0.3 && progress < 0.33) u.stuck += dt;
      else if (u.speed > 0.5) u.stuck = 0;
      // Wächter: unabhängig vom Grund, wer mit Weg 3 s lang nicht vorankommt, gilt als festgefahren
      if (!u.path.length || !u.watch || Math.hypot(u.x - u.watch.x, u.y - u.watch.y) > 0.5) u.watch = { x: u.x, y: u.y, t: this.time };
      else if (this.time - u.watch.t > 3) { u.stuck = 2; u.watch = { x: u.x, y: u.y, t: this.time }; }
      if (u.stuck > 1.5) {
        const goal = u.path[u.path.length - 1];
        // Klebt die Einheit seit der letzten Neuplanung am selben Fleck: auf die nächste freie Zellmitte setzen
        if (u.lastRepath && Math.hypot(u.x - u.lastRepath.x, u.y - u.lastRepath.y) < 3) {
          const free = nearestPassable(this.nav, mob, u.x + Math.cos(u.heading) * NAV_CELL, u.y + Math.sin(u.heading) * NAV_CELL);
          if (free && Math.hypot(free.x - u.x, free.y - u.y) < 3 * NAV_CELL) { u.x = free.x; u.y = free.y; }
        }
        u.lastRepath = { x: u.x, y: u.y };
        u.path = findPath(this.nav, u, goal, { mobility: mob, preferRoads: u.fast }) ?? [];
        // Ist schon der erste Punkt nicht direkt erreichbar, zuerst zur nächsten freien Zellmitte
        if (u.path.length && !segmentFree(this.nav, mob, u, u.path[0])) {
          const p = nearestPassable(this.nav, mob, u.x, u.y);
          if (p) u.path.unshift(p);
        }
        u.stuck = 0;
      }
    }
  }

  // Punkt auf dem Weg, bis zu LOOKAHEAD Meter voraus (Kurve statt Ecke für Ecke).
  // Ist der Punkt nicht in gerader Linie erreichbar (Hausecke dazwischen), kürzer vorausschauen.
  private aimPoint(u: Unit) {
    for (let look = LOOKAHEAD[u.type.mobility]; look > 2; look -= 2) {
      const p = this.pointAhead(u, look);
      if (this.lineFree(u, p)) return p;
    }
    return u.path[0];
  }

  private lineFree(u: Unit, p: { x: number; y: number }) {
    const d = Math.hypot(p.x - u.x, p.y - u.y), steps = Math.ceil(d / 1.5);
    for (let i = 1; i <= steps; i++) {
      if (!freeAt(this.nav, u.type.mobility, u.x + ((p.x - u.x) * i) / steps, u.y + ((p.y - u.y) * i) / steps)) return false;
    }
    return true;
  }

  private pointAhead(u: Unit, distance: number) {
    let rest = distance;
    let from = { x: u.x, y: u.y };
    for (const p of u.path) {
      const d = Math.hypot(p.x - from.x, p.y - from.y);
      if (d >= rest) return { x: from.x + ((p.x - from.x) * rest) / d, y: from.y + ((p.y - from.y) * rest) / d };
      rest -= d;
      from = p;
    }
    return from;
  }

  // Bewegen mit Kollision: nicht in Häuser, Wasser usw.; an Kanten entlangrutschen
  // Liefert den Anteil der gewollten Strecke, der tatsächlich geschafft wurde (0..1)
  private moveBy(u: Unit, dx: number, dy: number): number {
    const mob = u.type.mobility, len = Math.hypot(dx, dy);
    if (len === 0) return 1;
    if (freeAt(this.nav, mob, u.x + dx, u.y + dy)) { u.x += dx; u.y += dy; return 1; }
    if (freeAt(this.nav, mob, u.x + dx, u.y)) { u.x += dx; return Math.abs(dx) / len; }
    if (freeAt(this.nav, mob, u.x, u.y + dy)) { u.y += dy; return Math.abs(dy) / len; }
    u.speed *= 0.5;
    return 0;
  }

  // Wer sieht wen? Gegner sind entdeckt, solange mindestens eine eigene Einheit sie sieht
  // Insassen fahren mit; Absitzen, sobald das Fahrzeug steht; Aufsitzen, sobald die Infanterie da ist
  private updateTransport() {
    for (const u of this.units) {
      if (u.dead) continue;
      for (const p of u.cargo) { p.x = u.x; p.y = u.y; p.heading = u.heading; }
      if (u.dismountPending && u.cargo.length) {
        u.path = [];
        if (u.speed < 0.5) this.dismount(u);
      }
      if (u.mountTarget != null && !u.carrier) {
        const c = this.units.find(c => c.id === u.mountTarget && !c.dead);
        if (!c || this.freeSeats(c) < Math.ceil(u.hp)) { u.mountTarget = undefined; continue; }
        const d = Math.hypot(c.x - u.x, c.y - u.y);
        if (d < 14) this.mount(u, c);
        else if (!u.path.length || Math.hypot(u.path[u.path.length - 1].x - c.x, u.path[u.path.length - 1].y - c.y) > 25) {
          this.order([u], c, true);
          u.mountTarget = c.id; // order() hat es zurückgesetzt
        }
      }
    }
  }

  // Beide Seiten: eine Einheit ist entdeckt, solange ein Gegner sie sieht – oder sie gerade geschossen hat
  // und ein Gegner freie Sicht auf sie hat (Mündungsfeuer)
  private updateSpotting() {
    for (const u of this.units) {
      if (u.dead || u.carrier) { u.spotted = false; continue; }
      const enemies = this.units.filter(e => e.side !== u.side && !e.dead && !e.carrier);
      u.spotted = enemies.some(e => canSpot(this.sight, e, u));
      if (!u.spotted && this.time < (u.revealedUntil ?? 0)) {
        u.spotted = enemies.some(e => {
          const d = Math.hypot(e.x - u.x, e.y - u.y);
          return d <= e.type.optics && sightDistance(this.sight, e.x, e.y, u.x, u.y, e.type.optics) <= e.type.optics;
        });
      }
      if (u.spotted) u.lastSeen = { x: u.x, y: u.y, time: this.time };
    }
  }

  // Testmodus: Gegner fahren ab und zu ein Stück in ihrer Umgebung herum
  private wanderEnemies() {
    for (const u of this.units) {
      if (u.side !== 'red' || u.path.length || u.dead || u.duelWith != null) continue;
      u.wanderAt ??= this.time + WANDER.pauseMin * Math.random();
      if (this.time < u.wanderAt) continue;
      const a = Math.random() * Math.PI * 2, r = WANDER.radius * (0.4 + 0.6 * Math.random());
      const goal = { x: clamp(u.x + Math.cos(a) * r, 50, this.size - 50), y: clamp(u.y + Math.sin(a) * r, 50, this.size - 50) };
      u.path = findPath(this.nav, u, goal, { mobility: u.type.mobility, preferRoads: false }) ?? [];
      u.fast = false;
      u.wandering = true;
      u.wanderAt = this.time + WANDER.pauseMin + Math.random() * (WANDER.pauseMax - WANDER.pauseMin);
    }
  }

  // Reisegeschwindigkeit in m/s je nach Gelände und Befehl
  private cruise(u: Unit) {
    const t = u.type, mob = t.mobility;
    const f = speedAt(this.nav, mob, u.x, u.y);
    const road = this.nav.road[Math.floor(u.y / NAV_CELL) * this.nav.w + Math.floor(u.x / NAV_CELL)] === 1;
    const kmh = road ? t.roadSpeed * ROAD_SPEED[mob] : Math.min(t.offroadSpeed, t.roadSpeed * Math.max(f, 0.15)) * GAME_SPEED[mob];
    // Beschädigte Fahrzeuge sind langsamer, niedergehaltene Infanterie kriecht
    const damage = mob === 'foot' ? (u.supp >= PINNED && !u.retreating ? 0.4 : 1) : 0.5 + 0.5 * u.hp / u.maxHp;
    return (kmh / 3.6) * (u.fast ? 1 : CAUTIOUS[mob]) * damage;
  }

  // Einheit an einer Stelle (für Antippen); radius in Metern
  unitAt(x: number, y: number, radius: number, side?: Side) {
    let best: Unit | null = null, bestD = radius;
    for (const u of this.units) {
      if (u.dead || u.carrier || (side && u.side !== side)) continue;
      const d = Math.hypot(u.x - x, u.y - y);
      if (d < bestD) { best = u; bestD = d; }
    }
    return best;
  }
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
function angleDiff(a: number, b: number) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
