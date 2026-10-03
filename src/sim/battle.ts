// Gefechtsregeln: Sektoren erobern, Siegpunkte, Kommandopunkte und Verstärkung aus dem Deck.
// Dazu eine einfache Platzhalter-KI für die Gegenseite (die richtige KI kommt in Schritt 5b).

import { Card, Scenario, cardCost, cardKey, cardName } from '../data/scenario';
import type { Side, Unit, World } from './world';
import { Commander } from './ai';
import { parkJet } from './airstrike';

export const SECTOR_CELL = 16; // Auflösung der Sektorkarte in Metern
const CAPTURE_TIME = 8;        // Sekunden ungestörter Anwesenheit, bis ein Sektor wechselt
const AI_THINK = 3;            // so oft entscheidet die KI (Spielsekunden)

export interface Sector {
  name: string; x: number; y: number;
  owner: Side | null;
  contested: boolean;
  progress: number;      // 0..1 Eroberungsfortschritt für `capturer`
  capturer: Side | null;
  present: Record<Side, number>;
}

export class Battle {
  sectors: Sector[];
  sectorOf: Uint8Array;  // für jede Zelle der Index des Sektors
  n: number;
  score: Record<Side, number> = { blue: 0, red: 0 };
  points: Record<Side, number>;
  left: Record<Side, Map<string, number>>; // noch verfügbare Karten im Deck (Schlüssel: cardKey)
  winner: Side | null = null;
  ai: Partial<Record<Side, Commander>> = {};
  private aiTimer = 0;
  private aiSaving: string | null = null;

  // aiEconomy: Faktor auf Start- und laufende Kommandopunkte der KI (Schwierigkeit)
  constructor(readonly world: World, readonly sc: Scenario, aiSides: Side[] = ['red'], readonly aiEconomy = 1) {
    for (const side of aiSides) this.ai[side] = new Commander(this, side);
    world.depots = sc.entries; // an den Anmarschpunkten gibt es Nachschub
    this.sectors = sc.sectors.map(s => ({ ...s, owner: null, contested: false, progress: 0, capturer: null, present: { blue: 0, red: 0 } }));
    this.n = Math.ceil(world.size / SECTOR_CELL);
    this.sectorOf = new Uint8Array(this.n * this.n);
    for (let j = 0; j < this.n; j++) for (let i = 0; i < this.n; i++) {
      const x = (i + 0.5) * SECTOR_CELL, y = (j + 0.5) * SECTOR_CELL;
      let best = 0, bestD = Infinity;
      this.sectors.forEach((s, k) => { const d = (s.x - x) ** 2 + (s.y - y) ** 2; if (d < bestD) { bestD = d; best = k; } });
      this.sectorOf[j * this.n + i] = best;
    }
    const eco = (s: Side) => (this.ai[s] ? aiEconomy : 1);
    this.points = { blue: sc.startPoints * eco('blue'), red: sc.startPoints * eco('red') };
    this.left = {
      // Die KI bekommt auf höheren Stufen auch entsprechend mehr Einheiten im Deck
      blue: new Map(sc.decks.blue.map(c => [cardKey(c), Math.round(c.count * eco('blue'))])),
      red: new Map(sc.decks.red.map(c => [cardKey(c), Math.round(c.count * eco('red'))])),
    };
  }

  sectorAt(x: number, y: number) {
    const i = Math.min(this.n - 1, Math.max(0, Math.floor(x / SECTOR_CELL)));
    const j = Math.min(this.n - 1, Math.max(0, Math.floor(y / SECTOR_CELL)));
    return this.sectors[this.sectorOf[j * this.n + i]];
  }

  // Zwischenstand: Punkte, Sektoren, Kommandopunkte, lebende Einheiten je Seite
  snapshot() {
    const alive = (side: Side) => {
      const n = new Map<string, number>();
      for (const u of this.world.units) if (u.side === side && !u.dead && !u.offmap) n.set(u.type.id, (n.get(u.type.id) ?? 0) + 1);
      return [...n].map(([id, k]) => `${id}×${k}`).join(' ');
    };
    const sectors = this.sectors.map(s => `${s.name}:${s.contested ? 'umkämpft' : s.owner === 'blue' ? 'BW' : s.owner === 'red' ? 'RU' : '-'}`).join(', ');
    return `STAND Punkte BW ${Math.floor(this.score.blue)} : RU ${Math.floor(this.score.red)} · KP ${Math.floor(this.points.blue)} : ${Math.floor(this.points.red)} · ${sectors}\n      BW: ${alive('blue')}\n      RU: ${alive('red')}`;
  }

  held(side: Side) { return this.sectors.filter(s => s.owner === side && !s.contested).length; }

  card(side: Side, key: string): Card | undefined { return this.sc.decks[side].find(c => cardKey(c) === key); }

  canBuy(side: Side, key: string) {
    const c = this.card(side, key);
    return !!c && !this.winner && (this.left[side].get(key) ?? 0) > 0 && this.points[side] >= cardCost(c);
  }

  // Karte kaufen: kommt am nächstgelegenen eigenen Anmarschpunkt auf die Karte und fährt schnell zum Ziel;
  // Transporter bringen ihre Infanterie gleich mit (sitzt drin)
  buy(side: Side, key: string, dest: { x: number; y: number }): Unit | null {
    if (!this.canBuy(side, key)) return null;
    const c = this.card(side, key)!;
    this.points[side] -= cardCost(c);
    this.left[side].set(key, this.left[side].get(key)! - 1);
    const entries = this.sc.entries[side];
    const e = entries.reduce((a, b) => (Math.hypot(b.x - dest.x, b.y - dest.y) < Math.hypot(a.x - dest.x, a.y - dest.y) ? b : a));
    this.world.note(`[${side === 'blue' ? 'BW' : 'RU'}] kauft ${cardName(c)} (${cardCost(c)} KP, Rest ${Math.floor(this.points[side])})`);
    const u = this.world.spawn(c.unit, side, e.x, e.y, side === 'blue' ? 0 : Math.PI);
    if (c.passengers) this.world.mount(this.world.spawn(c.passengers, side, e.x, e.y), u);
    if (u.type.air === 'jet') parkJet(u); // Jets warten außerhalb der Karte auf ihren Einsatz
    else this.world.order([u], dest, true);
    return u;
  }

  update(dt: number) {
    if (this.winner) return;
    // Wer ist in welchem Sektor? (Zurückweichende zählen nicht)
    for (const s of this.sectors) s.present = { blue: 0, red: 0 };
    for (const u of this.world.units) if (!u.dead && !u.retreating && !u.carrier && !u.type.air) this.sectorAt(u.x, u.y).present[u.side]++;
    for (const s of this.sectors) {
      const b = s.present.blue > 0, r = s.present.red > 0;
      s.contested = b && r;
      const side: Side | null = b && !r ? 'blue' : r && !b ? 'red' : null;
      if (!side || side === s.owner) { if (!s.contested) { s.progress = 0; s.capturer = null; } continue; }
      if (s.capturer !== side) { s.capturer = side; s.progress = 0; }
      s.progress += dt / CAPTURE_TIME;
      if (s.progress >= 1) {
        s.owner = side; s.progress = 0; s.capturer = null;
        this.world.log(`${side === 'blue' ? 'Wir halten' : 'Gegner hält'} jetzt ${s.name}`, side === 'blue' ? 'red' : 'blue', true);
      }
    }
    for (const side of ['blue', 'red'] as Side[]) {
      const held = this.held(side);
      this.score[side] += held * this.sc.scorePerSector * dt;
      this.points[side] += (this.sc.income + held * this.sc.incomePerSector) * dt * (this.ai[side] ? this.aiEconomy : 1);
    }
    if (this.score.blue >= this.sc.winScore || this.score.red >= this.sc.winScore) {
      this.winner = this.score.blue >= this.score.red ? 'blue' : 'red';
    }
    // Jede Minute ein Zwischenstand für den Bericht
    if (Math.floor(this.world.time / 60) !== Math.floor((this.world.time - dt) / 60)) this.world.note(this.snapshot());
    this.aiTimer -= dt;
    if (this.aiTimer <= 0) { this.aiTimer = AI_THINK; for (const c of Object.values(this.ai)) c.think(); }
  }

  // Einfache KI (nur noch zum Vergleich in Tests): kauft zufällig und schickt freie Einheiten
  // zum nächsten Sektor, der ihr nicht gehört. Die richtige KI steht in ai.ts.
  simpleAi(side: Side) {
    const w = this.world;
    const mine = w.units.filter(u => u.side === side && !u.dead);
    const targets = this.sectors.filter(s => s.owner !== side || s.contested);
    const home = this.sc.entries[side][1];
    const goal = (from: { x: number; y: number }) => {
      const list = targets.length ? targets : this.sectors;
      return list.reduce((a, b) => (Math.hypot(b.x - from.x, b.y - from.y) < Math.hypot(a.x - from.x, a.y - from.y) ? b : a));
    };
    // Kaufen: mal billig, mal auf etwas Großes sparen
    if (!this.aiSaving) {
      const options = [...this.left[side].entries()].filter(([, n]) => n > 0).map(([id]) => id);
      if (options.length) this.aiSaving = options[Math.floor(Math.random() * options.length)];
    }
    if (this.aiSaving && (this.left[side].get(this.aiSaving) ?? 0) === 0) this.aiSaving = null;
    if (this.aiSaving && this.canBuy(side, this.aiSaving)) {
      const g = goal(home);
      this.buy(side, this.aiSaving, { x: g.x + (Math.random() - 0.5) * 120, y: g.y + (Math.random() - 0.5) * 120 });
      this.aiSaving = null;
    }
    // Freie Einheiten losschicken (wer kämpft oder sich zurückzieht, bleibt)
    for (const u of mine) {
      if (u.path.length || u.retreating || w.time - (u.lastShot ?? -99) < 10) continue;
      const here = this.sectorAt(u.x, u.y);
      // Umkämpfter Sektor, aber kein Gegner in Sicht: zur Sektormitte vorgehen und ihn suchen
      if (here.contested) {
        if (w.time - (u.lastShot ?? -99) > 20 && Math.random() < 0.3) w.order([u], { x: here.x + (Math.random() - 0.5) * 160, y: here.y + (Math.random() - 0.5) * 160 }, false);
        continue;
      }
      if (here.owner !== side) continue; // erst diesen Sektor nehmen
      if (Math.random() < 0.5) continue; // nicht alle gleichzeitig
      const g = goal(u);
      w.order([u], { x: g.x + (Math.random() - 0.5) * 150, y: g.y + (Math.random() - 0.5) * 150 }, false);
    }
  }
}
