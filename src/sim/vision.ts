// Sicht und Entdecken: Sichtlinien über das Gelände, Tarnung der Ziele, Sichtkarte fürs Abdunkeln.
// Alle Stellschrauben stehen oben.

import type { GameMap } from '../map/load';
import { TERRAIN, Terrain } from '../map/terrain';
import type { Category } from '../data/units';
import type { Unit } from './world';

// Wie stark Gelände die Sicht schluckt: Meter Sichtweite, die ein Meter dieses Geländes „kostet“.
// Häuser blockieren ganz (Infinity). Am Rand von Wald oder Haus kann man noch hinaussehen (EDGE).
const SIGHT_COST: Record<Terrain, number> = {
  open: 1, grass: 1, field: 1, road: 1, bridge: 1, rail: 1.3, water: 1,
  garden: 2, scrub: 3, forest: 9, building: Infinity,
};
const EDGE = 12; // Meter am Anfang und Ende der Sichtlinie, die nicht zählen (Waldrand, Fenster)

// Tarnung: Wie groß bzw. auffällig ist die Einheit (1 = Kampfpanzer im offenen Gelände)
export const SIZE: Record<Category, number> = { tank: 1, ifv: 0.9, apc: 0.85, recon: 0.6, infantry: 0.35, at: 0.3, artillery: 0.9, heli: 1, jet: 1, aa: 0.8, supply: 0.8 };
// Deckung am Standort des Ziels
const CONCEAL: Record<Terrain, number> = {
  open: 1, grass: 1, field: 0.95, road: 1, bridge: 1, rail: 0.9, water: 1,
  garden: 0.75, scrub: 0.6, forest: 0.4, building: 0.35,
};
const MOVING = 1.35;   // Bewegung macht auffälliger
const MIN_SPOT = 60;   // so nah wird alles entdeckt, was in Sichtlinie ist
const STEP = 4;        // Schrittweite der Sichtlinie in Metern (= Rasterzelle)

// Kosten-Raster einmal vorberechnen
export interface Smoke { x: number; y: number; r: number; until: number }
export interface SightGrid { w: number; cell: number; cost: Float32Array; terrainAt: (x: number, y: number) => Terrain; smoke: Smoke[] }

export function buildSight(map: GameMap): SightGrid {
  const cost = Float32Array.from(map.terrain, t => SIGHT_COST[TERRAIN[t]]);
  return { w: map.grid.w, cell: map.cell, cost, terrainAt: map.terrainAt, smoke: [] };
}

// „Effektive Entfernung“ entlang der Sichtlinie: Meter mal Sichtkosten; Infinity, wenn ein Haus dazwischen ist
export function sightDistance(g: SightGrid, ax: number, ay: number, bx: number, by: number, limit = Infinity) {
  const len = Math.hypot(bx - ax, by - ay);
  // Rauch: wer durch eine Wolke schaut, sieht nichts dahinter
  for (const s of g.smoke) if (segmentDist(s.x, s.y, ax, ay, bx, by) < s.r) return Infinity;
  const steps = Math.max(1, Math.ceil(len / STEP)), d = len / steps;
  let sum = 0;
  for (let i = 1; i < steps; i++) {
    const along = i * d;
    if (along < EDGE || len - along < EDGE) { sum += d; continue; }
    const x = ax + ((bx - ax) * i) / steps, y = ay + ((by - ay) * i) / steps;
    const c = g.cost[Math.floor(y / g.cell) * g.w + Math.floor(x / g.cell)] ?? 1;
    sum += d * c;
    if (sum > limit) return Infinity;
  }
  return sum + d;
}

function segmentDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(ax + dx * t - px, ay + dy * t - py);
}
const inSmoke = (g: SightGrid, x: number, y: number) => g.smoke.some(s => Math.hypot(s.x - x, s.y - y) < s.r);

// Kann der Beobachter das Ziel gerade entdecken?
export function canSpot(g: SightGrid, observer: Unit, target: Unit) {
  const dist = Math.hypot(target.x - observer.x, target.y - observer.y);
  if (dist > observer.type.optics) return false;
  // Jet von oben: keine Sichtlinie nötig, aber Tarnung (Wald, Haus) wirkt weiter; Rauch verdeckt
  if (observer.type.air === 'jet') {
    const conceal = SIZE[target.type.category] * (target.type.air ? 1 : CONCEAL[g.terrainAt(target.x, target.y)]) * (target.speed > 0.5 ? MOVING : 1);
    return dist <= Math.max(MIN_SPOT, observer.type.optics * conceal) && !g.smoke.some(s => Math.hypot(s.x - target.x, s.y - target.y) < s.r);
  }
  // Luftfahrzeuge: Gelände am Boden tarnt sie nicht (Häuser und Wald dazwischen blockieren aber weiter die Sicht)
  const conceal = SIZE[target.type.category] * (target.type.air ? 1 : CONCEAL[g.terrainAt(target.x, target.y)]) * (target.speed > 0.5 ? MOVING : 1);
  const range = Math.max(MIN_SPOT, Math.min(observer.type.optics, observer.type.optics * conceal));
  return sightDistance(g, observer.x, observer.y, target.x, target.y, range) <= range;
}

// ---------- Sichtkarte fürs Abdunkeln (grob, 16-m-Zellen) ----------
export const VIEW_CELL = 16;
const RAYS = 240;

export function computeViewMap(g: SightGrid, size: number, observers: Unit[], out: Uint8Array) {
  const n = Math.ceil(size / VIEW_CELL);
  out.fill(0);
  for (const o of observers) {
    const range = o.type.optics;
    // Jet: sieht von oben alles im Umkreis
    if (o.type.air === 'jet') {
      const r = Math.ceil(range / VIEW_CELL), cx = Math.floor(o.x / VIEW_CELL), cy = Math.floor(o.y / VIEW_CELL);
      for (let y = Math.max(0, cy - r); y < Math.min(n, cy + r + 1); y++) for (let x = Math.max(0, cx - r); x < Math.min(n, cx + r + 1); x++) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) out[y * n + x] = 1;
      }
      continue;
    }
    for (let r = 0; r < RAYS; r++) {
      const a = (r / RAYS) * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      let budget = range, along = 0;
      while (budget > 0) {
        along += STEP;
        const x = o.x + dx * along, y = o.y + dy * along;
        if (x < 0 || y < 0 || x >= size || y >= size) break;
        const c = along < EDGE ? 1 : g.cost[Math.floor(y / g.cell) * g.w + Math.floor(x / g.cell)];
        budget -= STEP * c;
        if (budget < 0 && c !== Infinity) break;
        out[Math.floor(y / VIEW_CELL) * n + Math.floor(x / VIEW_CELL)] = 1; // auch das blockierende Haus selbst ist sichtbar
        if (c === Infinity || (g.smoke.length && inSmoke(g, x, y))) break;
      }
    }
  }
}
