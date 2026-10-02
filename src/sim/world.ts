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

// ---------- Stellschrauben fürs Fahrgefühl ----------
// Spieltempo statt Echtzeit-Tempo: Fahrzeuge langsamer, Infanterie schneller, damit beides auf 2 km zusammenpasst
const GAME_SPEED = { tracked: 0.5, wheeled: 0.45, foot: 2.7 };
// Normales Bewegen ist vorsichtiger als „Schnell“ (Infanterie geht statt zu rennen)
const CAUTIOUS = { tracked: 0.65, wheeled: 0.65, foot: 0.6 };
// Drehgeschwindigkeit in Grad pro Sekunde; Kettenfahrzeuge drehen auf der Stelle, Radfahrzeuge lenken
const TURN_RATE = { tracked: 45, wheeled: 35, foot: 240 };
// Beschleunigung und Bremsen in m/s²
const ACCEL = { tracked: 1.5, wheeled: 2.2, foot: 3 };
// Wegpunkt gilt als erreicht innerhalb dieser Entfernung (Zwischenpunkte großzügiger als das Ziel)
const ARRIVE = { final: 2, between: 7 };

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
      const path = findPath(this.nav, u, goal, { mobility: u.type.mobility, preferRoads: fast }) ?? [];
      // Wegpunkte direkt bei der Einheit weglassen, sonst dreht sie erst einmal um
      while (path.length > 1 && Math.hypot(path[0].x - u.x, path[0].y - u.y) < 12) path.shift();
      u.path = path;
      u.fast = fast;
    });
  }

  stop(units: Unit[]) {
    for (const u of units) u.path = [];
  }

  update(dt: number) {
    for (const u of this.units) {
      const mob = u.type.mobility;
      const next = u.path[0];
      let want = 0; // gewünschte Geschwindigkeit in m/s
      if (next) {
        const last = u.path.length === 1;
        const dx = next.x - u.x, dy = next.y - u.y, dist = Math.hypot(dx, dy);
        if (dist < (last ? ARRIVE.final : ARRIVE.between)) { u.path.shift(); continue; }
        const diff = angleDiff(Math.atan2(dy, dx), u.heading);
        const turn = (TURN_RATE[mob] * Math.PI) / 180;
        u.heading += Math.max(-turn * dt, Math.min(turn * dt, diff));
        want = this.cruise(u);
        if (mob === 'tracked' && Math.abs(diff) > 0.6) want = 0; // erst auf der Stelle drehen
        else if (mob === 'wheeled') {
          // Wendekreis: ist der Punkt zu nah für den Lenkeinschlag, langsamer fahren; geht es gar nicht, Punkt auslassen
          const radius = Math.max(u.speed, 1) / turn;
          if (Math.abs(diff) > 1.2 && dist < radius * 1.5) {
            if (!last) { u.path.shift(); continue; }
            want = Math.min(want, 2);
          } else want *= Math.max(0.3, Math.cos(diff));
        } else want *= Math.max(0, Math.cos(diff));
        // Vor dem Ziel abbremsen
        if (last) want = Math.min(want, Math.sqrt(2 * ACCEL[mob] * dist));
      }
      // Beschleunigen bzw. bremsen
      const a = ACCEL[mob] * dt;
      u.speed = want > u.speed ? Math.min(want, u.speed + a) : Math.max(want, u.speed - a * 2);
      u.x += Math.cos(u.heading) * u.speed * dt;
      u.y += Math.sin(u.heading) * u.speed * dt;
    }
  }

  // Reisegeschwindigkeit in m/s je nach Gelände und Befehl
  private cruise(u: Unit) {
    const t = u.type, mob = t.mobility;
    const f = speedAt(this.nav, mob, u.x, u.y);
    const road = this.nav.road[Math.floor(u.y / NAV_CELL) * this.nav.w + Math.floor(u.x / NAV_CELL)] === 1;
    const kmh = road ? t.roadSpeed : Math.min(t.offroadSpeed, t.roadSpeed * Math.max(f, 0.15));
    return (kmh / 3.6) * GAME_SPEED[mob] * (u.fast ? 1 : CAUTIOUS[mob]);
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
