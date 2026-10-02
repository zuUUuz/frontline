// Spielwelt: Einheiten, ihre Befehle und die Bewegung über das Gelände.

import { UnitType, unitType } from '../data/units';
import { NavGrid, NAV_CELL, findPath, nearestPassable, speedAt } from './nav';

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
}

// Drehgeschwindigkeit in Grad pro Sekunde
const TURN_RATE = { tracked: 50, wheeled: 40, foot: 180 };
// Normales Bewegen ist vorsichtiger als „Schnell“
const CAUTIOUS = 0.6;

export class World {
  units: Unit[] = [];
  private nextId = 1;

  constructor(readonly nav: NavGrid, readonly size: number) {}

  spawn(typeId: string, side: Side, x: number, y: number, heading = 0) {
    const type = unitType(typeId);
    const p = nearestPassable(this.nav, type.mobility, x, y) ?? { x, y };
    const unit: Unit = { id: this.nextId++, type, side, x: p.x, y: p.y, heading, path: [], fast: false, speed: 0 };
    this.units.push(unit);
    return unit;
  }

  // Bewegungsbefehl für eine Gruppe: Ziele nebeneinander quer zur Marschrichtung
  order(units: Unit[], target: { x: number; y: number }, fast: boolean) {
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
      const path = findPath(this.nav, u, goal, { mobility: u.type.mobility, preferRoads: fast });
      u.path = path ?? [];
      u.fast = fast;
    });
  }

  stop(units: Unit[]) {
    for (const u of units) u.path = [];
  }

  update(dt: number) {
    for (const u of this.units) {
      const next = u.path[0];
      if (!next) { u.speed = 0; continue; }
      const dx = next.x - u.x, dy = next.y - u.y, dist = Math.hypot(dx, dy);
      if (dist < 1.5) { u.path.shift(); continue; }
      // Erst in Richtung drehen; bei großem Winkel fast auf der Stelle
      const want = Math.atan2(dy, dx);
      const diff = angleDiff(want, u.heading);
      const maxTurn = (TURN_RATE[u.type.mobility] * Math.PI / 180) * dt;
      u.heading += Math.max(-maxTurn, Math.min(maxTurn, diff));
      const align = Math.max(0, Math.cos(diff));
      // Geschwindigkeit je Gelände: Straße = Straßentempo, sonst Geländetempo mal Geländefaktor
      const f = speedAt(this.nav, u.type.mobility, u.x, u.y);
      const road = this.nav.road[Math.floor(u.y / NAV_CELL) * this.nav.w + Math.floor(u.x / NAV_CELL)] === 1;
      const kmh = road ? u.type.roadSpeed : Math.min(u.type.offroadSpeed, u.type.roadSpeed * Math.max(f, 0.15));
      u.speed = (kmh / 3.6) * (u.fast ? 1 : CAUTIOUS) * align * align;
      const step = Math.min(dist, u.speed * dt);
      u.x += Math.cos(u.heading) * step;
      u.y += Math.sin(u.heading) * step;
    }
  }

  // Einheit an einer Stelle (für Antippen); radius in Metern
  unitAt(x: number, y: number, radius: number, side?: Side) {
    let best: Unit | null = null, bestD = radius;
    for (const u of this.units) {
      if (side && u.side !== side) continue;
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
