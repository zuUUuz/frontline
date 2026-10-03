// Gegner-KI („Kommandeur“): klärt zuerst auf, sammelt gemischte Gruppen, greift Sektoren an,
// verteidigt bedrohte Sektoren und zieht angeschlagene Fahrzeuge zurück.
// Sie weiß nur, was ihre eigenen Einheiten gesehen haben (letzte bekannte Positionen), sie schummelt nicht.

import { unitType, type Category } from '../data/units';
import type { Battle, Sector } from './battle';
import type { Side, Unit } from './world';

const MEMORY = 90;          // so lange (s) merkt sich die KI gesichtete Gegner
const SCOUT_RANGE = 700;    // so nah muss eine Einheit an der Sektormitte gewesen sein, damit er als aufgeklärt gilt
const SCOUT_STALE = 150;    // nach so vielen Sekunden gilt ein Sektor wieder als unbekannt
const UNKNOWN_THREAT = 150; // angenommene Gegnerstärke in einem unbekannten gegnerischen Sektor (Punkte)
const ATTACK_RATIO = 1.5;   // so viel stärker als der bekannte Gegner will die KI angreifen
const STAGE_DIST = 350;     // Bereitstellungsraum so weit vor dem Ziel
const RETREAT_HP = 0.4;     // Fahrzeuge unter diesem Zustand ziehen sich zurück
const MAX_GROUPS = 3;

// Kaufpläne: erst Aufklärung und ein kleiner Trupp, danach gemischte Pakete
const OPENING: Category[] = ['recon', 'infantry', 'ifv', 'infantry'];
const PACKAGES: Category[][] = [
  ['tank', 'infantry', 'ifv'],
  ['at', 'infantry', 'apc'],
  ['tank', 'ifv', 'infantry'],
  ['infantry', 'at', 'tank'],
];

type Phase = 'gather' | 'stage' | 'assault';
interface Group { units: Unit[]; target: Sector; rally: P; staging: P; phase: Phase; since: number; startValue: number }
interface P { x: number; y: number }

export const value = (u: Unit) => u.type.cost * (u.hp / u.maxHp);
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

export class Commander {
  private groups: Group[] = [];
  private garrison = new Map<Unit, Sector>();
  private retreating = new Set<Unit>();
  private dest = new Map<Unit, P>();
  private scouted = new Map<Sector, number>();
  private queue: Category[] = [...OPENING];
  private pkg = 0;

  constructor(readonly battle: Battle, readonly side: Side) {}

  private get w() { return this.battle.world; }
  private get home(): P { const e = this.battle.sc.entries[this.side]; return e[Math.floor(e.length / 2)]; }

  think() {
    const b = this.battle, w = this.w, now = w.time;
    const mine = w.units.filter(u => u.side === this.side && !u.dead);
    // Aufgeklärt ist, wo eigene Einheiten in der Nähe sind
    for (const s of b.sectors) if (mine.some(u => dist(u, s) < Math.min(SCOUT_RANGE, u.type.optics))) this.scouted.set(s, now);
    for (const g of this.groups) g.units = g.units.filter(u => !u.dead);
    for (const [u] of this.garrison) if (u.dead) this.garrison.delete(u);

    this.buy();
    this.relieveGarrisons();
    this.withdrawDamaged(mine);
    this.scout(mine);
    this.defend(mine);
    this.runGroups();
    this.planAttack(mine);
    this.idle(mine);
  }

  // ---------- Was weiß die KI über den Gegner? ----------
  threatIn(s: Sector) {
    let v = 0;
    for (const e of this.w.units) {
      if (e.side === this.side || e.dead || !e.lastSeen || this.w.time - e.lastSeen.time > MEMORY) continue;
      if (this.battle.sectorAt(e.lastSeen.x, e.lastSeen.y) === s) v += value(e);
    }
    return v;
  }
  private known(s: Sector) { return this.w.time - (this.scouted.get(s) ?? -999) < SCOUT_STALE; }
  // Neutrale Sektoren, in denen nie ein Gegner gesehen wurde, gelten als leer (schnell besetzen)
  private expectedThreat(s: Sector) {
    if (this.known(s) || (s.owner === null && !s.contested)) return this.threatIn(s);
    return Math.max(UNKNOWN_THREAT, this.threatIn(s));
  }

  // ---------- Einkaufen ----------
  private buy() {
    const b = this.battle;
    if (!this.queue.length) {
      const recon = this.w.units.some(u => u.side === this.side && !u.dead && u.type.category === 'recon');
      this.queue = recon ? [...PACKAGES[this.pkg++ % PACKAGES.length]] : ['recon'];
    }
    const cat = this.queue[0];
    const id = [...b.left[this.side].entries()].find(([id, n]) => n > 0 && unitType(id).category === cat)?.[0];
    if (!id) { this.queue.shift(); return; } // Deck leer für diese Art
    if (!b.canBuy(this.side, id)) return; // sparen
    // Neue Einheiten gleich dorthin, wo sie gebraucht werden: zur sammelnden Gruppe oder an die Front
    const forming = this.groups.find(g => g.phase === 'gather');
    const to = forming ? forming.rally : this.frontline();
    const u = b.buy(this.side, id, { x: to.x + (Math.random() - 0.5) * 100, y: to.y + (Math.random() - 0.5) * 100 });
    if (u) { this.queue.shift(); this.dest.set(u, to); if (forming) forming.units.push(u); }
  }

  // Eigener Sektor, der dem nächsten Ziel am nächsten liegt (sonst der Anmarschpunkt)
  private frontline(): P {
    const own = this.battle.sectors.filter(s => s.owner === this.side && !s.contested);
    const goals = this.battle.sectors.filter(s => s.owner !== this.side);
    if (!own.length) return this.closestTo(goals.length ? goals : this.battle.sectors, this.home);
    if (!goals.length) return own[0];
    let best = own[0], bestD = Infinity;
    for (const o of own) for (const g of goals) { const d = dist(o, g); if (d < bestD) { bestD = d; best = o; } }
    return best;
  }
  private closestTo<T extends P>(list: T[], p: P): T {
    return list.reduce((a, c) => (dist(c, p) < dist(a, p) ? c : a));
  }

  // Ruhige Sektoren brauchen nur eine Besatzung (am liebsten Infanterie); der Rest wird wieder frei
  private relieveGarrisons() {
    const bySector = new Map<Sector, Unit[]>();
    for (const [u, s] of this.garrison) bySector.set(s, [...(bySector.get(s) ?? []), u]);
    for (const [s, units] of bySector) {
      if (s.owner === this.side && !s.contested && this.threatIn(s) > 0) continue; // bedroht: alle bleiben
      const keep = s.owner === this.side ? units.sort((a, b) => Number(b.type.mobility === 'foot') - Number(a.type.mobility === 'foot'))[0] : null;
      for (const u of units) if (u !== keep) this.garrison.delete(u);
    }
  }

  // ---------- Angeschlagene Fahrzeuge zurück ----------
  private withdrawDamaged(mine: Unit[]) {
    for (const u of mine) {
      if (u.type.mobility === 'foot' || this.retreating.has(u) || u.hp / u.maxHp >= RETREAT_HP) continue;
      this.release(u);
      this.retreating.add(u);
      this.move(u, this.home, true, true);
      if (u.spotted) this.w.log(`${u.type.name} (Gegner) setzt sich angeschlagen ab`, this.side === 'red' ? 'blue' : 'red');
    }
  }

  // ---------- Aufklärung ----------
  private scout(mine: Unit[]) {
    for (const u of mine) {
      if (u.type.category !== 'recon' || this.retreating.has(u)) continue;
      // Unter Beschuss: ein Stück zurück
      if (u.supp > 20 && u.lastHitFrom) {
        const a = Math.atan2(u.y - u.lastHitFrom.y, u.x - u.lastHitFrom.x);
        this.move(u, { x: u.x + Math.cos(a) * 300, y: u.y + Math.sin(a) * 300 }, true, true);
        continue;
      }
      if (u.path.length) continue;
      // Ältester unbekannter Sektor, der nicht uns gehört; Beobachtungspunkt etwas davor
      const cands = this.battle.sectors.filter(s => s.owner !== this.side || s.contested);
      if (!cands.length) continue;
      const s = cands.reduce((a, c) => ((this.scouted.get(c) ?? -999) + dist(u, c) / 20 < (this.scouted.get(a) ?? -999) + dist(u, a) / 20 ? c : a));
      if (this.known(s) && dist(u, s) < 900) continue; // schon im Blick
      const a = Math.atan2(this.home.y - s.y, this.home.x - s.x);
      this.move(u, { x: s.x + Math.cos(a) * 500, y: s.y + Math.sin(a) * 500 }, false);
    }
  }

  // ---------- Verteidigung ----------
  private defend(mine: Unit[]) {
    for (const s of this.battle.sectors) {
      if (s.owner !== this.side) continue;
      const threat = this.threatIn(s);
      if (threat <= 0) continue;
      let have = mine.filter(u => this.battle.sectorAt(u.x, u.y) === s).reduce((a, u) => a + value(u), 0);
      const free = this.pool(mine).filter(u => u.type.category !== 'recon').sort((a, b2) => dist(a, s) - dist(b2, s));
      for (const u of free) {
        if (have >= threat * 1.2) break;
        if (dist(u, s) > 900) break;
        this.garrison.set(u, s);
        this.move(u, jitter(s, 120, u.id), true);
        have += value(u);
      }
    }
  }

  // ---------- Angriff planen ----------
  private planAttack(mine: Unit[]) {
    // Kleine Trupps, die nur leere Sektoren besetzen, zählen nicht als Angriffsgruppe
    if (this.groups.filter(g => g.startValue > 100 || g.units.length > 1).length >= MAX_GROUPS) return;
    const pool = this.pool(mine).filter(u => u.type.category !== 'recon');
    if (!pool.length) return;
    const poolValue = pool.reduce((a, u) => a + value(u), 0);
    const from = this.frontline();
    const targets = this.battle.sectors.filter(s => (s.owner !== this.side || s.contested) && !this.groups.some(g => g.target === s));
    let best: Sector | null = null, bestScore = 0;
    for (const s of targets) {
      const need = this.need(s);
      if (need > poolValue || (need > 0 && pool.length < 3)) continue;
      // Lieber nahe, umkämpfte, aufgeklärte und schwach besetzte Ziele – keine Vorstöße quer über die Karte
      const d = Math.min(dist(from, s), ...pool.map(u => dist(u, s)));
      const score = (s.contested ? 2 : 1) * (this.known(s) ? 1.5 : 1) / (1 + need / 300) / (1 + (d / 600) ** 2);
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (!best) return;
    const target = best;
    const need = this.need(target);
    const units: Unit[] = [];
    let v = 0;
    for (const u of pool.sort((a, b2) => dist(a, target) - dist(b2, target))) {
      if (v >= need * 1.2 && units.length >= (need ? 3 : 1)) break;
      units.push(u); v += value(u);
    }
    const rally = dist(from, target) < 400 ? this.home : from;
    const a = Math.atan2(rally.y - target.y, rally.x - target.x);
    const staging = { x: target.x + Math.cos(a) * STAGE_DIST, y: target.y + Math.sin(a) * STAGE_DIST };
    // Leerer Sektor: ohne Sammeln direkt hin
    this.groups.push({ units, target, rally, staging, phase: need ? 'gather' : 'assault', since: this.w.time, startValue: v });
  }

  // Wie viel Kampfkraft braucht ein Angriff? 0 = Sektor scheint leer, eine Einheit reicht
  private need(s: Sector) {
    const t = this.expectedThreat(s);
    // Liegt die KI nach Sektoren hinten, geht sie mehr Risiko ein
    const enemy = this.side === 'red' ? 'blue' : 'red';
    const ratio = this.battle.held(enemy) > this.battle.held(this.side) ? 1.1 : ATTACK_RATIO;
    return t > 0 ? Math.max(120, t * ratio) : 0;
  }

  // ---------- Gruppen führen: sammeln → bereitstellen → angreifen ----------
  private runGroups() {
    const now = this.w.time;
    this.groups = this.groups.filter(g => {
      const v = g.units.reduce((a, u) => a + value(u), 0);
      // Zu große Verluste oder der Gegner ist stärker als gedacht: abbrechen und zurück
      if (!g.units.length || v < g.startValue * 0.35 || v < this.need(g.target) * 0.7) {
        for (const u of g.units) this.move(u, g.rally, true, true);
        return false;
      }
      // Ziel genommen: zwei Fußtrupps bleiben als Besatzung, der Rest wird frei
      if (g.target.owner === this.side && !g.target.contested) {
        const stay = g.units.filter(u => u.type.mobility === 'foot').slice(0, 2);
        for (const u of stay) this.garrison.set(u, g.target);
        return false;
      }
      const near = (p: P, r: number) => g.units.filter(u => dist(u, p) < r).length / g.units.length;
      if (g.phase === 'gather') {
        for (const u of g.units) this.move(u, jitter(g.rally, 100, u.id), true);
        if (near(g.rally, 250) >= 0.75 || now - g.since > 40) { g.phase = 'stage'; g.since = now; }
      } else if (g.phase === 'stage') {
        for (const u of g.units) this.move(u, jitter(g.staging, 90, u.id), true);
        if (near(g.staging, 200) >= 0.7 || now - g.since > 35) { g.phase = 'assault'; g.since = now; }
      } else {
        // Verbundene Waffen: Infanterie stürmt, Schützen- und Transportpanzer folgen dicht dahinter,
        // Kampfpanzer und Panzerabwehr geben aus dem Bereitstellungsraum Feuerschutz, bis der Sektor frei ist
        const clear = this.threatIn(g.target) === 0;
        for (const u of g.units) {
          const cat = u.type.category;
          // Halten und kämpfen: wer gerade schießt, bleibt stehen (trifft besser, Lenkraketen nur im Stand)
          if (this.w.time - (u.lastShot ?? -99) < 6 && cat !== 'infantry') { if (u.path.length) { this.w.stop([u]); this.dest.delete(u); } continue; }
          const overwatch = !clear && (cat === 'tank' || cat === 'at');
          const to = overwatch ? g.staging : cat === 'infantry' ? g.target : towards(g.target, g.staging, 80);
          this.move(u, jitter(to, overwatch ? 80 : 120, u.id), cat === 'infantry' || clear);
        }
        if (now - g.since > 120) { g.since = now; for (const u of g.units) this.dest.delete(u); } // neu verteilen
      }
      return true;
    });
  }

  // Freie Einheiten: nicht in Gruppe, nicht Besatzung, nicht auf dem Rückzug
  private pool(mine: Unit[]) {
    return mine.filter(u => !this.retreating.has(u) && !this.garrison.has(u) && !this.groups.some(g => g.units.includes(u)) && !u.retreating);
  }

  private idle(mine: Unit[]) {
    // Wer ohne Aufgabe herumsteht, geht zum vordersten eigenen Sektor
    const front = this.frontline();
    for (const u of this.pool(mine)) {
      if (u.type.category === 'recon' || u.path.length) continue;
      if (dist(u, front) > 250) this.move(u, jitter(front, 150, u.id), true);
    }
    // Abgesetzte Fahrzeuge, die daheim angekommen sind, stehen wieder zur Verfügung (wenn auch angeschlagen)
    for (const u of [...this.retreating]) if (!u.path.length && dist(u, this.home) < 150) this.retreating.delete(u);
  }

  private release(u: Unit) {
    this.garrison.delete(u);
    for (const g of this.groups) g.units = g.units.filter(x => x !== u);
  }

  // Befehl nur geben, wenn sich das Ziel wirklich ändert (sonst plant die Einheit ständig neu)
  private move(u: Unit, to: P, fast: boolean, force = false) {
    const d = this.dest.get(u);
    if (!force && d && dist(d, to) < 150 && (u.path.length || dist(u, d) < 60)) return;
    const size = this.w.size;
    const p = { x: Math.min(size - 20, Math.max(20, to.x)), y: Math.min(size - 20, Math.max(20, to.y)) };
    this.dest.set(u, p);
    this.w.order([u], p, fast);
  }
}

// Fester Versatz je Einheit, damit eine Gruppe nicht auf einem Punkt klebt und Befehle stabil bleiben
function jitter(p: P, r: number, seed: number): P {
  const a = seed * 2.399963, k = 0.35 + 0.65 * ((seed * 0.618034) % 1);
  return { x: p.x + Math.cos(a) * r * k, y: p.y + Math.sin(a) * r * k };
}
function towards(a: P, b: P, d: number): P {
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: a.x + ((b.x - a.x) / l) * d, y: a.y + ((b.y - a.y) / l) * d };
}
