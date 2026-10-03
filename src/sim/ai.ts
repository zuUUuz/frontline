// Gegner-KI („Kommandeur“): klärt zuerst auf, kauft passend zum Gegner, sammelt gemischte Gruppen,
// greift von der schwächsten Seite an, verteidigt aus Stellungen im Hinterhalt, bündelt das Feuer
// und zieht angeschlagene Fahrzeuge zurück.
// Sie weiß nur, was ihre eigenen Einheiten gesehen haben (letzte bekannte Positionen), sie schummelt nicht.

import { unitType, type Category } from '../data/units';
import type { Battle, Sector } from './battle';
import { cardKey } from '../data/scenario';
import type { Side, Unit } from './world';
import { Position, findPositions } from './positions';
import { NAV_CELL } from './nav';
import { isArtillery, orderFire } from './artillery';
import { callStrike, isJet } from './airstrike';

const MEMORY = 90;          // so lange (s) merkt sich die KI gesichtete Gegner
const SCOUT_RANGE = 700;    // so nah muss eine Einheit an der Sektormitte gewesen sein, damit er als aufgeklärt gilt
const SCOUT_STALE = 150;    // nach so vielen Sekunden gilt ein Sektor wieder als unbekannt
const UNKNOWN_THREAT = 150; // angenommene Gegnerstärke in einem unbekannten gegnerischen Sektor (Punkte)
const ATTACK_RATIO = 1.5;   // so viel stärker als der bekannte Gegner will die KI angreifen
const STAGE_DIST = 350;     // Bereitstellungsraum so weit vor dem Ziel
const RETREAT_HP = 0.4;     // Fahrzeuge unter diesem Zustand ziehen sich zurück
const CONTACT_VALUE = 120; // angenommene Stärke eines unsichtbaren Schützen
const MAX_GROUPS = 2;        // lieber ein, zwei starke Stöße als viele kleine

// Kaufpläne: erst Aufklärung und ein kleiner Trupp, danach gemischte Pakete
const OPENING: Category[] = ['recon', 'infantry', 'ifv', 'infantry'];
// Gegen viele Panzer: Panzerabwehr; gegen viel Infanterie: Schützenpanzer und Infanterie
const VS_ARMOR: Category[] = ['at', 'tank', 'infantry'];
const VS_SOFT: Category[] = ['ifv', 'infantry', 'apc'];
const PACKAGES: Category[][] = [
  ['tank', 'infantry', 'ifv'],
  ['at', 'infantry', 'apc'],
  ['tank', 'ifv', 'infantry'],
  ['infantry', 'at', 'tank'],
  ['artillery', 'ifv', 'infantry'],
  ['heli', 'infantry', 'tank'],
];

type Phase = 'gather' | 'stage' | 'assault';
interface Group { units: Unit[]; target: Sector; rally: P; staging: P; phase: Phase; since: number; startValue: number }
interface P { x: number; y: number }

export const value = (u: Unit): number => u.type.cost * (u.hp / u.maxHp) + u.cargo.reduce((s, p) => s + value(p), 0);
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

export class Commander {
  private groups: Group[] = [];
  private garrison = new Map<Unit, Sector>();
  private retreating = new Set<Unit>();
  private dest = new Map<Unit, P>();
  private scouted = new Map<Sector, number>();
  private queue: Category[] = [...OPENING];
  private pkg = 0;
  private posts = new Map<Sector, { foot: Position[]; vehicle: Position[] }>();
  private posted = new Map<Unit, Position>(); // wer gerade eine Stellung besetzt (liegt dort im Hinterhalt)
  private danger: Float32Array | null = null;  // Gefahrenkarte je Navigationszelle
  private contacts: { x: number; y: number; t: number }[] = []; // Herkunft von Schüssen unsichtbarer Gegner
  private evading = new Map<Unit, number>();   // weicht unsichtbarem Beschuss aus (bis Spielzeit)
  private dangerAt = -99;

  constructor(readonly battle: Battle, readonly side: Side) {}

  private get w() { return this.battle.world; }
  private get home(): P { const e = this.battle.sc.entries[this.side]; return e[Math.floor(e.length / 2)]; }

  think() {
    const b = this.battle, w = this.w, now = w.time;
    const all = w.units.filter(u => u.side === this.side && !u.dead && !u.carrier);
    const guns = all.filter(isArtillery);
    const jets = all.filter(isJet);
    const mine = all.filter(u => !isArtillery(u) && !isJet(u)); // Artillerie und Jets werden getrennt geführt
    // Aufgeklärt ist, wo eigene Einheiten in der Nähe sind
    for (const s of b.sectors) if (mine.some(u => dist(u, s) < Math.min(SCOUT_RANGE, u.type.optics))) this.scouted.set(s, now);
    for (const g of this.groups) g.units = g.units.filter(u => !u.dead);
    for (const [u] of this.garrison) if (u.dead) this.garrison.delete(u);
    for (const [u] of this.posted) if (u.dead) this.posted.delete(u);

    this.noteContacts(mine);
    if (now - this.dangerAt > 12) { this.dangerAt = now; this.danger = this.computeDanger(); }
    this.buy();
    this.relieveGarrisons();
    this.dismountWhenUseful(mine);
    this.withdrawDamaged(mine);
    this.reactToFire(mine);
    this.scout(mine);
    this.defend(mine);
    this.runGroups();
    this.planAttack(mine);
    this.idle(mine);
    this.fireSupport(guns, mine);
    this.airStrikes(jets, mine);
    // Wer in Stellung liegt, schießt erst, wenn der Gegner nah genug ist (Hinterhalt)
    for (const u of mine) u.ambush = this.posted.has(u) && !u.path.length;
  }

  // Gefahrenkarte: Welches Gelände können die bekannten Gegner einsehen und beschießen?
  // Sichtstrahlen von jeder zuletzt gesehenen Gegnerposition, so weit wie ihre Waffen reichen
  private computeDanger() {
    const nav = this.w.nav, g = this.w.sight, size = this.w.size;
    const out = new Float32Array(nav.w * nav.h);
    const RAYS = 360;
    for (const e of this.w.units) {
      if (e.side === this.side || e.dead || !e.lastSeen || this.w.time - e.lastSeen.time > MEMORY) continue;
      const range = Math.min(2500, Math.max(...e.type.weapons.map(wp => wp.range)));
      const weight = value(e) / 100, ox: number = e.lastSeen.x, oy: number = e.lastSeen.y;
      for (let r = 0; r < RAYS; r++) {
        const a = (r / RAYS) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
        let budget = range;
        let last = -1;
        for (let d = NAV_CELL; budget > 0; d += NAV_CELL) {
          const x = ox + dx * d, y = oy + dy * d;
          if (x < 0 || y < 0 || x >= size || y >= size) break;
          const c = d < 12 ? 1 : g.cost[Math.floor(y / g.cell) * g.w + Math.floor(x / g.cell)];
          if (c === Infinity) break;
          budget -= NAV_CELL * c;
          const i = Math.floor(y / NAV_CELL) * nav.w + Math.floor(x / NAV_CELL);
          if (i !== last) { out[i] += weight * (1 - d / (range * 1.5)); last = i; }
        }
      }
    }
    // Unsichtbare Schützen: Umkreis gefährlich machen (ohne Sichtlinie, die kennt man ja nicht genau)
    for (const c of this.contacts) {
      const r = 1500 / NAV_CELL, cx = Math.floor(c.x / NAV_CELL), cy = Math.floor(c.y / NAV_CELL);
      for (let y = Math.max(0, cy - r); y < Math.min(nav.h, cy + r); y += 1) for (let x = Math.max(0, cx - r); x < Math.min(nav.w, cx + r); x += 1) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d < 1) out[y * nav.w + x] += 1.2 * (1 - d);
      }
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.min(4, out[i]);
    return out;
  }

  // Wie stark drückt der (bekannte) Gegner auf diesen Punkt? (aus der Gefahrenkarte, Umkreis 40 m)
  private pressure(p: P) {
    if (!this.danger) return 0;
    const nav = this.w.nav;
    let v = 0;
    for (let oy = -40; oy <= 40; oy += NAV_CELL) for (let ox = -40; ox <= 40; ox += NAV_CELL) {
      const x = Math.floor((p.x + ox) / NAV_CELL), y = Math.floor((p.y + oy) / NAV_CELL);
      if (x >= 0 && y >= 0 && x < nav.w && y < nav.h) v += this.danger[y * nav.w + x];
    }
    return v * 10;
  }

  // ---------- Stellungen ----------
  private postsOf(s: Sector) {
    let p = this.posts.get(s);
    if (!p) {
      const b = this.battle, w = this.w;
      const enemy = b.sc.entries[this.side === 'red' ? 'blue' : 'red'][1];
      const inS = (x: number, y: number) => b.sectorAt(x, y) === s && Math.hypot(x - s.x, y - s.y) < 450;
      p = { foot: findPositions(w.sight, w.nav, w.size, inS, enemy, 'foot'), vehicle: findPositions(w.sight, w.nav, w.size, inS, enemy, 'tracked') };
      this.posts.set(s, p);
    }
    return p;
  }

  // Einheit in die beste freie Stellung im Sektor schicken (Infanterie in Häuser/Waldränder, Fahrzeuge an Waldränder)
  private occupy(u: Unit, s: Sector) {
    const cur = this.posted.get(u);
    if (cur && this.battle.sectorAt(cur.x, cur.y) === s) { this.move(u, cur, true); return; }
    const list = u.type.mobility === 'foot' ? this.postsOf(s).foot : this.postsOf(s).vehicle;
    const taken = new Set(this.posted.values());
    const free = list.find(p => !taken.has(p) && (u.type.mobility === 'foot' || u.type.mobility === 'tracked' || this.w.sight.terrainAt(p.x, p.y) !== 'forest'));
    if (free) { this.posted.set(u, free); this.move(u, free, true); }
    else { this.posted.delete(u); this.move(u, jitter(s, 120, u.id), true); }
  }

  // ---------- Was weiß die KI über den Gegner? ----------
  threatIn(s: Sector) {
    let v = 0;
    for (const e of this.w.units) {
      if (e.side === this.side || e.dead || !e.lastSeen || this.w.time - e.lastSeen.time > MEMORY) continue;
      if (this.battle.sectorAt(e.lastSeen.x, e.lastSeen.y) === s) v += value(e);
    }
    for (const c of this.contacts) if (this.battle.sectorAt(c.x, c.y) === s) v += CONTACT_VALUE;
    return v;
  }

  // ---------- Artillerie ----------
  private fired = new Map<string, number>(); // wann zuletzt auf welches Ziel geschossen wurde
  private smoked = new Set<Group>();

  // Feuerstellung: hinten, nahe dem eigenen Kartenrand; nach jedem Auftrag Stellungswechsel (gegen Gegenbatterie)
  private firingBase(u: Unit): P {
    const h = this.home, inward = this.side === 'red' ? -1 : 1;
    const k = (u.id * 0.618034) % 1;
    return { x: h.x + inward * (220 + 120 * k), y: h.y + (k - 0.5) * 500 };
  }

  private fireSupport(guns: Unit[], mine: Unit[]) {
    const now = this.w.time;
    for (const g of guns) {
      if (g.mission) continue;
      const base = this.firingBase(g);
      // Gerade gefeuert und geortet: Stellung wechseln
      if (g.lastSeen && now - g.lastSeen.time < 15 && !g.path.length && dist(g, g.lastSeen) < 30) {
        const a = Math.random() * Math.PI * 2;
        this.move(g, { x: base.x + Math.cos(a) * 150, y: base.y + Math.sin(a) * 150 }, true, true);
        continue;
      }
      if (g.path.length) continue;
      if (dist(g, base) > 400) { this.move(g, base, true); continue; }
      const t = this.pickFireTarget(g, mine);
      if (!t) continue;
      if (orderFire(this.w, [g], t.x, t.y, t.smoke)) this.fired.set(t.key, now);
    }
  }

  // Wohin schießen? Gegenbatterie > Unterstützung der Angriffe (Spreng, beim Sturm Rauch) > Verteidigung > lohnende Ziele
  private pickFireTarget(g: Unit, mine: Unit[]): (P & { smoke: boolean; key: string }) | null {
    const now = this.w.time;
    const known = this.w.units.filter(e => e.side !== this.side && !e.dead && !e.carrier && e.lastSeen && now - e.lastSeen.time < 40);
    const safe = (p: P) => !mine.some(u => dist(u, p) < 90); // nicht auf eigene Leute
    const recent = (key: string, s: number) => now - (this.fired.get(key) ?? -999) < s;
    // 1. Gegenbatterie
    for (const e of known) {
      if (!isArtillery(e) || now - e.lastSeen!.time > 25) continue;
      const key = `cb${e.id}`;
      if (!recent(key, 20) && safe(e.lastSeen!)) return { ...e.lastSeen!, smoke: false, key };
    }
    // 2. Angriffe unterstützen: Rauch beim Sturm zwischen Feind und Bereitstellung, sonst Spreng auf den Feind im Ziel
    for (const gr of this.groups) {
      const c = this.cluster(known.filter(e => this.battle.sectorAt(e.lastSeen!.x, e.lastSeen!.y) === gr.target));
      if (!c) continue;
      if (gr.phase === 'assault' && !this.smoked.has(gr) && g.smokeAmmo > 0) {
        this.smoked.add(gr);
        const p = towards(c, gr.staging, Math.min(200, dist(c, gr.staging) * 0.4));
        return { ...p, smoke: true, key: `smoke${p.x | 0}` };
      }
      const key = `sup${c.x >> 6},${c.y >> 6}`;
      if (gr.phase !== 'gather' && !recent(key, 30) && safe(c)) return { ...c, smoke: false, key };
    }
    // 3. Verteidigung und 4. lohnende Ziele (Infanterie und leichte Fahrzeuge, gern stehend)
    const soft = known.filter(e => e.type.mobility === 'foot' || e.type.armor.side <= 20);
    const own = soft.filter(e => this.battle.sectorAt(e.lastSeen!.x, e.lastSeen!.y).owner === this.side);
    for (const list of [own, soft]) {
      const c = this.cluster(list);
      if (!c || c.v < (list === own ? 40 : 90)) continue;
      const key = `hit${c.x >> 6},${c.y >> 6}`;
      if (!recent(key, 40) && safe(c)) return { ...c, smoke: false, key };
    }
    return null;
  }

  // ---------- Jets ----------
  // Lohnende Fahrzeugansammlung, möglichst ohne bekannte Flugabwehr in der Nähe
  private airStrikes(jets: Unit[], mine: Unit[]) {
    const now = this.w.time;
    const ready = jets.filter(j => j.sortie?.phase === 'ready');
    if (!ready.length) return;
    const known = this.w.units.filter(e => e.side !== this.side && !e.dead && !e.carrier && e.lastSeen && now - e.lastSeen.time < 20);
    const aa = known.filter(e => e.type.category === 'aa');
    const c = this.cluster(known.filter(e => e.type.mobility !== 'foot' && !e.type.air));
    if (!c || c.v < 150) return;
    const defended = aa.some(e => dist(e.lastSeen!, c) < 3000);
    if (defended && c.v < 350) return;
    if (mine.some(u => dist(u, c) < 80)) return; // nicht auf eigene Leute
    const target = known.find(e => dist(e.lastSeen!, c) < 60 && e.spotted);
    callStrike(this.w, ready[0], c.x, c.y, target);
  }

  // Dichteste Ansammlung bekannter Gegner (Mitte und Wert im Umkreis von 60 m)
  private cluster(list: Unit[]): (P & { v: number }) | null {
    let best: (P & { v: number }) | null = null;
    for (const e of list) {
      const near = list.filter(o => dist(o.lastSeen!, e.lastSeen!) < 60);
      const v = near.reduce((s, o) => s + value(o), 0);
      if (!best || v > best.v) best = { x: near.reduce((s, o) => s + o.lastSeen!.x, 0) / near.length, y: near.reduce((s, o) => s + o.lastSeen!.y, 0) / near.length, v };
    }
    return best;
  }

  // ---------- Absitzen ----------
  // Angreifer sitzen kurz vor dem Ziel ab; alle anderen, sobald sie angekommen sind oder beschossen werden
  private dismountWhenUseful(mine: Unit[]) {
    const now = this.w.time;
    for (const u of mine) {
      if (!u.cargo.length || u.dismountPending) continue;
      const g = this.groups.find(g => g.units.includes(u));
      const underFire = now - (u.suppAt ?? -99) < 3;
      const arrived = !u.path.length;
      const go = g ? (g.phase === 'assault' && (dist(u, g.target) < 350 || underFire)) || (g.phase !== 'assault' && underFire)
        : arrived || underFire;
      if (!go) continue;
      u.dismountPending = true;
      if (g) g.units.push(...u.cargo); // die Infanterie gehört zur Gruppe des Fahrzeugs
    }
  }

  // ---------- Beschuss von unsichtbaren Gegnern ----------
  // Wer getroffen wird, ohne den Schützen zu sehen, kennt wenigstens die Richtung: die Stelle wird gemerkt
  private noteContacts(mine: Unit[]) {
    const now = this.w.time;
    this.contacts = this.contacts.filter(c => now - c.t < MEMORY);
    for (const u of mine) {
      if (!u.lastHitFrom || now - (u.suppAt ?? -99) > 3.5) continue;
      const h = u.lastHitFrom;
      const seen = this.w.units.some(e => e.side !== this.side && !e.dead && e.spotted && dist(e, h) < 60);
      if (seen) continue;
      const near = this.contacts.find(c => dist(c, h) < 100);
      if (near) near.t = now; else this.contacts.push({ x: h.x, y: h.y, t: now });
    }
  }

  // Fahrzeuge unter Feuer, die nicht zurückschießen können: raus aus der Schusslinie, in Deckung.
  // Den nächsten Aufklärer zum Schützen schicken, damit er ihn findet.
  private reactToFire(mine: Unit[]) {
    const now = this.w.time;
    for (const [u, until] of this.evading) if (u.dead || now > until) this.evading.delete(u);
    for (const u of mine) {
      if (u.type.mobility === 'foot' || this.evading.has(u) || this.retreating.has(u) || !u.lastHitFrom) continue;
      if (now - (u.suppAt ?? -99) > 3.5 || now - (u.lastShot ?? -99) < 6) continue; // nicht beschossen oder kämpft ohnehin
      const inAssault = this.groups.some(g => g.phase === 'assault' && g.units.includes(u));
      if (inAssault || this.garrison.has(u)) continue; // Angreifer und Besatzungen halten durch
      // Nur ausweichen, wenn der Schütze außer eigener Reichweite steht (Scharfschütze auf Distanz)
      const reach = Math.max(...u.type.weapons.map(wp => wp.range));
      if (dist(u, u.lastHitFrom) < reach * 0.9) continue;
      const a = Math.atan2(u.y - u.lastHitFrom.y, u.x - u.lastHitFrom.x);
      this.posted.delete(u);
      this.evading.set(u, now + 25);
      this.move(u, { x: u.x + Math.cos(a) * 200, y: u.y + Math.sin(a) * 200 }, true, true);
      const recon = mine.filter(r => r.type.category === 'recon' && !this.retreating.has(r)).sort((p, q) => dist(p, u) - dist(q, u))[0];
      if (recon && dist(recon, u.lastHitFrom) > 700) {
        const back = Math.atan2(u.y - u.lastHitFrom.y, u.x - u.lastHitFrom.x);
        this.move(recon, { x: u.lastHitFrom.x + Math.cos(back + 0.6) * 650, y: u.lastHitFrom.y + Math.sin(back + 0.6) * 650 }, false, true);
      }
    }
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
      // Artillerie gehört dazu: ab der zweiten Minute immer ein Geschütz im Einsatz (solange das Deck reicht)
      const guns = this.w.units.filter(u => u.side === this.side && !u.dead && isArtillery(u)).length;
      const gunsLeft = b.sc.decks[this.side].some(c => unitType(c.unit).category === 'artillery' && (b.left[this.side].get(cardKey(c)) ?? 0) > 0);
      // Luft: ein Jet ab Minute 4; Flugabwehr, sobald gegnerische Luftfahrzeuge gesehen wurden
      const has = (cat: Category) => this.w.units.filter(u => u.side === this.side && !u.dead && u.type.category === cat).length;
      const left = (cat: Category) => b.sc.decks[this.side].some(c => unitType(c.unit).category === cat && (b.left[this.side].get(cardKey(c)) ?? 0) > 0);
      const enemyAir = this.w.units.some(e => e.side !== this.side && !e.dead && e.type.air && e.lastSeen && this.w.time - e.lastSeen.time < 180);
      this.queue = !recon ? ['recon']
        : guns < (this.w.time > 420 ? 2 : 1) && gunsLeft && this.w.time > 90 ? ['artillery']
        : enemyAir && has('aa') < 2 && left('aa') ? ['aa']
        : this.w.time > 240 && has('jet') < 1 && left('jet') ? ['jet']
        : [...this.nextPackage()];
    }
    const cat = this.queue[0];
    // Schützen- und Transportpanzer am liebsten mit Infanterie an Bord
    const cards = b.sc.decks[this.side].filter(c => (b.left[this.side].get(cardKey(c)) ?? 0) > 0 && unitType(c.unit).category === cat);
    // Hubschrauber: Kampfhubschrauber (Lufttransport führt die KI noch nicht)
    const card = cat === 'heli' ? cards.find(c => !c.passengers) : cards.find(c => c.passengers) ?? cards[0];
    const id = card && cardKey(card);
    if (!id) { this.queue.shift(); return; } // Deck leer für diese Art
    if (!b.canBuy(this.side, id)) return; // sparen
    // Neue Einheiten gleich dorthin, wo sie gebraucht werden: zur sammelnden Gruppe oder an die Front
    const forming = cat === 'artillery' ? undefined : this.groups.find(g => g.phase === 'gather');
    const h = this.home;
    const to = cat === 'artillery' ? { x: h.x + (this.side === 'red' ? -280 : 280), y: h.y } : forming ? forming.rally : this.frontline();
    const u = b.buy(this.side, id, { x: to.x + (Math.random() - 0.5) * 100, y: to.y + (Math.random() - 0.5) * 100 });
    if (u) { this.queue.shift(); this.dest.set(u, to); if (forming) forming.units.push(u); }
  }

  // Was hat der Gegner? Danach richtet sich der nächste Einkauf
  private nextPackage(): Category[] {
    let armor = 0, soft = 0;
    for (const e of this.w.units) {
      if (e.side === this.side || e.dead || !e.lastSeen || this.w.time - e.lastSeen.time > 180) continue;
      if (e.type.category === 'tank' || e.type.category === 'ifv') armor += value(e); else soft += value(e);
    }
    if (armor > 200 && armor > soft * 1.3) return VS_ARMOR;
    if (soft > 150 && soft > armor * 1.5) return VS_SOFT;
    return PACKAGES[this.pkg++ % PACKAGES.length];
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
      if (u.spotted) this.w.log(`${u.type.name} (Gegner) setzt sich angeschlagen ab`, this.side === 'red' ? 'blue' : 'red', true);
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
      const free = this.pool(mine).filter(u => u.type.category !== 'recon' && dist(u, s) < 900).sort((a, b2) => dist(a, s) - dist(b2, s));
      for (const u of free) {
        if (have >= threat * 1.2) break;
        this.garrison.set(u, s);
        this.occupy(u, s);
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
      const enemyOwned = s.owner !== null && s.owner !== this.side;
      const score = (s.contested ? 2 : 1) * (enemyOwned ? 1.4 : 1) * (this.known(s) ? 1.5 : 1) / (1 + need / 300) / (1 + (d / 600) ** 2);
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
      this.posted.delete(u);
    }
    const rally = dist(from, target) < 400 ? this.home : from;
    // Bereitstellung dort, wo der bekannte Gegner am wenigsten drückt (flankieren), nicht zu weit vom Sammelpunkt
    let staging = towards(target, rally, STAGE_DIST), bestCost = Infinity;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const p = { x: target.x + Math.cos(a) * STAGE_DIST, y: target.y + Math.sin(a) * STAGE_DIST };
      if (p.x < 40 || p.y < 40 || p.x > this.w.size - 40 || p.y > this.w.size - 40) continue;
      const cost = this.pressure(p) + 0.25 * dist(rally, p) + (this.w.sight.terrainAt(p.x, p.y) === 'water' ? 1e6 : 0);
      if (cost < bestCost) { bestCost = cost; staging = p; }
    }
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
        for (const u of stay) { this.garrison.set(u, g.target); this.occupy(u, g.target); }
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
          const overwatch = !clear && (cat === 'tank' || cat === 'at' || cat === 'heli');
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
    return mine.filter(u => !this.retreating.has(u) && !this.evading.has(u) && !this.garrison.has(u) && !this.groups.some(g => g.units.includes(u)) && !u.retreating);
  }

  private idle(mine: Unit[]) {
    // Wer ohne Aufgabe herumsteht, geht zum vordersten eigenen Sektor
    // Wer ohne Aufgabe ist, bezieht im vordersten eigenen Sektor eine Stellung (Reserve im Hinterhalt)
    const front = this.frontline();
    const frontSector = this.battle.sectorAt(front.x, front.y);
    for (const u of this.pool(mine)) {
      if (u.type.category === 'recon' || u.path.length) continue;
      if (frontSector.owner === this.side) this.occupy(u, frontSector);
      else if (dist(u, front) > 250) this.move(u, jitter(front, 150, u.id), true);
    }
    // Abgesetzte Fahrzeuge, die daheim angekommen sind, stehen wieder zur Verfügung (wenn auch angeschlagen)
    for (const u of [...this.retreating]) if (!u.path.length && dist(u, this.home) < 150) this.retreating.delete(u);
  }

  private release(u: Unit) {
    this.garrison.delete(u);
    this.posted.delete(u);
    for (const g of this.groups) g.units = g.units.filter(x => x !== u);
  }

  // Befehl nur geben, wenn sich das Ziel wirklich ändert (sonst plant die Einheit ständig neu)
  private move(u: Unit, to: P, fast: boolean, force = false) {
    const d = this.dest.get(u);
    if (!force && d && dist(d, to) < 150 && (u.path.length || dist(u, d) < 60)) return;
    const size = this.w.size;
    const p = { x: Math.min(size - 20, Math.max(20, to.x)), y: Math.min(size - 20, Math.max(20, to.y)) };
    this.dest.set(u, p);
    this.w.order([u], p, fast, this.danger ?? undefined); // Wege meiden eingesehenes Gelände
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
