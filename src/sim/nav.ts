// Wegfindung auf einem groben Navigationsraster (8-m-Zellen) mit A*.
// Jede Bewegungsart (Kette, Rad, zu Fuß) hat eigene Geschwindigkeiten je Gelände.

import type { GameMap } from '../map/load';
import { TERRAIN, Terrain } from '../map/terrain';
import type { Mobility } from '../data/units';

// Anteil der Straßengeschwindigkeit je Gelände (0 = unpassierbar).
// Gelände-Werte bezogen auf die Straßengeschwindigkeit; die Geländegeschwindigkeit der Einheit begrenzt zusätzlich.
const SPEED: Record<Mobility, Record<Terrain, number>> = {
  tracked: { open: 1, grass: 1, field: 0.9, forest: 0.25, scrub: 0.6, garden: 0.5, water: 0, road: 1, rail: 0.35, building: 0, bridge: 1 },
  wheeled: { open: 0.8, grass: 0.8, field: 0.6, forest: 0, scrub: 0.3, garden: 0.35, water: 0, road: 1, rail: 0.2, building: 0, bridge: 1 },
  foot: { open: 1, grass: 1, field: 0.9, forest: 0.8, scrub: 0.8, garden: 0.9, water: 0, road: 1, rail: 0.8, building: 0.5, bridge: 1 },
};
const ON_ROAD = new Set<Terrain>(['road', 'bridge']);

export const NAV_CELL = 8;

export interface NavGrid {
  w: number;
  h: number;
  speed: Record<Mobility, Float32Array>; // Faktor 0..1 je Zelle; 0 = unpassierbar
  road: Uint8Array;                      // 1 = überwiegend Straße
  penalty: Record<Mobility, Float32Array>; // Aufschlag für Zellen nahe an Hindernissen (Abstand halten)
  fine: { w: number; cell: number; blocked: Record<Mobility, Uint8Array> }; // feines Kollisionsraster (4 m)
}

// Aufschlag je Abstand zum nächsten Hindernis (in Navigationszellen): angeschnitten, direkt daneben, eins weiter
const CLEARANCE_PENALTY: Record<Mobility, number[]> = {
  tracked: [3, 1.2, 0.3],
  wheeled: [3, 1.2, 0.3],
  foot: [0.5, 0.1, 0],
};

// Aus dem 4-m-Gelände das 8-m-Navigationsraster bauen: Mittelwert der Teilzellen,
// unpassierbar, wenn mehr als die Hälfte unpassierbar ist
export function buildNav(map: GameMap): NavGrid {
  const k = Math.round(NAV_CELL / map.cell), w = Math.floor(map.grid.w / k), h = Math.floor(map.grid.h / k);
  const mob: Mobility[] = ['tracked', 'wheeled', 'foot'];
  const speed = Object.fromEntries(mob.map(m => [m, new Float32Array(w * h)])) as NavGrid['speed'];
  const road = new Uint8Array(w * h);
  const partial = Object.fromEntries(mob.map(m => [m, new Uint8Array(w * h)])) as Record<Mobility, Uint8Array>;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sums = { tracked: 0, wheeled: 0, foot: 0 }, blocked = { tracked: 0, wheeled: 0, foot: 0 };
    let roads = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const t = TERRAIN[map.terrain[(y * k + dy) * map.grid.w + x * k + dx]];
      if (ON_ROAD.has(t)) roads++;
      for (const m of mob) { const s = SPEED[m][t]; sums[m] += s; if (s === 0) blocked[m]++; }
    }
    const i = y * w + x, n = k * k;
    for (const m of mob) { speed[m][i] = blocked[m] * 2 > n ? 0 : sums[m] / n; partial[m][i] = blocked[m] > 0 ? 1 : 0; }
    road[i] = roads * 2 >= n ? 1 : 0;
  }

  // Abstand zu Hindernissen: 0 = angeschnitten, 1 = direkt daneben, 2 = eine Zelle weiter
  const penalty = Object.fromEntries(mob.map(m => {
    const pen = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (speed[m][i] === 0) continue;
      let d = partial[m][i] ? 0 : 3;
      for (let r = 1; r <= 2 && d > r; r++) {
        for (let dy = -r; dy <= r && d > r; dy++) for (let dx = -r; dx <= r; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (speed[m][ny * w + nx] === 0) { d = r; break; }
        }
      }
      pen[i] = d < 3 ? CLEARANCE_PENALTY[m][d] : 0;
    }
    return [m, pen];
  })) as NavGrid['penalty'];

  // Feines Raster für die Kollision beim Fahren
  const fineBlocked = Object.fromEntries(mob.map(m => [m, Uint8Array.from(map.terrain, t => (SPEED[m][TERRAIN[t]] === 0 ? 1 : 0))])) as Record<Mobility, Uint8Array>;
  return { w, h, speed, road, penalty, fine: { w: map.grid.w, cell: map.cell, blocked: fineBlocked } };
}

// Schritt von Zellmitte zu Zellmitte auf dem feinen Raster prüfen
function stepFree(nav: NavGrid, mobility: Mobility, cx: number, cy: number, nx: number, ny: number) {
  for (const t of [0.25, 0.5, 0.75, 1]) {
    if (!freeAt(nav, mobility, (cx + (nx - cx) * t + 0.5) * NAV_CELL, (cy + (ny - cy) * t + 0.5) * NAV_CELL)) return false;
  }
  return true;
}

// Gerade Strecke auf dem feinen Raster prüfen
export function segmentFree(nav: NavGrid, mobility: Mobility, a: { x: number; y: number }, b: { x: number; y: number }) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 1.5));
  for (let i = 1; i <= steps; i++) {
    if (!freeAt(nav, mobility, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps)) return false;
  }
  return true;
}

// Ist dieser Punkt für die Bewegungsart frei? (feines Raster)
export function freeAt(nav: NavGrid, mobility: Mobility, x: number, y: number) {
  const f = nav.fine, gx = Math.floor(x / f.cell), gy = Math.floor(y / f.cell);
  if (gx < 0 || gy < 0 || gx >= f.w || gy >= f.w) return false;
  return f.blocked[mobility][gy * f.w + gx] === 0;
}

// ---------- A* ----------
class Heap {
  private items: number[] = [];
  private prio: number[] = [];
  get size() { return this.items.length; }
  push(item: number, p: number) {
    const a = this.items, q = this.prio;
    a.push(item); q.push(p);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (q[parent] <= q[i]) break;
      [a[i], a[parent]] = [a[parent], a[i]]; [q[i], q[parent]] = [q[parent], q[i]];
      i = parent;
    }
  }
  pop(): number {
    const a = this.items, q = this.prio, top = a[0], lastA = a.pop()!, lastQ = q.pop()!;
    if (a.length) {
      a[0] = lastA; q[0] = lastQ;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && q[l] < q[m]) m = l;
        if (r < a.length && q[r] < q[m]) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; [q[i], q[m]] = [q[m], q[i]];
        i = m;
      }
    }
    return top;
  }
}

export interface PathOptions {
  mobility: Mobility;
  preferRoads: boolean; // „Schnell bewegen“: Straßen bevorzugen
  danger?: Float32Array; // je Navigationszelle: wie sehr der Gegner hier hinsieht (macht Zellen teurer, KI)
}

const cellOf = (nav: NavGrid, x: number, y: number) =>
  Math.min(nav.h - 1, Math.max(0, Math.floor(y / NAV_CELL))) * nav.w + Math.min(nav.w - 1, Math.max(0, Math.floor(x / NAV_CELL)));

export const speedAt = (nav: NavGrid, mobility: Mobility, x: number, y: number) => nav.speed[mobility][cellOf(nav, x, y)];

// Nächste befahrbare Zelle zu einem Punkt (falls das Ziel z. B. im Haus oder See liegt)
export function nearestPassable(nav: NavGrid, mobility: Mobility, x: number, y: number): { x: number; y: number } | null {
  const s = nav.speed[mobility], cx = Math.floor(x / NAV_CELL), cy = Math.floor(y / NAV_CELL);
  for (let r = 0; r < 40; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const gx = cx + dx, gy = cy + dy;
      if (gx < 0 || gy < 0 || gx >= nav.w || gy >= nav.h || s[gy * nav.w + gx] === 0) continue;
      if (!freeAt(nav, mobility, (gx + 0.5) * NAV_CELL, (gy + 0.5) * NAV_CELL)) continue;
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { x: (gx + 0.5) * NAV_CELL, y: (gy + 0.5) * NAV_CELL, d };
    }
    if (best) return r === 0 && freeAt(nav, mobility, x, y) ? { x, y } : { x: best.x, y: best.y };
  }
  return null;
}

// Liefert eine Liste von Wegpunkten in Metern (ohne Startpunkt) oder null, wenn kein Weg existiert
export function findPath(nav: NavGrid, from: { x: number; y: number }, to: { x: number; y: number }, opt: PathOptions) {
  const s = nav.speed[opt.mobility], w = nav.w;
  const goalPt = nearestPassable(nav, opt.mobility, to.x, to.y);
  if (!goalPt) return null;
  const start = cellOf(nav, from.x, from.y), goal = cellOf(nav, goalPt.x, goalPt.y);
  // Kosten einer Zelle: Zeit pro Meter; bei „Schnell“ kosten Nicht-Straßen extra
  const pen = nav.penalty[opt.mobility];
  const dg = opt.danger;
  const cost = (i: number) => (1 / Math.max(s[i], 0.05)) * (opt.preferRoads && !nav.road[i] ? 1.25 : 1) * (1 + pen[i]) * (dg ? 1 + dg[i] : 1);
  const g = new Float32Array(nav.w * nav.h).fill(Infinity);
  const came = new Int32Array(nav.w * nav.h).fill(-1);
  const closed = new Uint8Array(nav.w * nav.h);
  const open = new Heap();
  const gx = goal % w, gy = (goal / w) | 0;
  const h = (i: number) => Math.hypot((i % w) - gx, ((i / w) | 0) - gy) * NAV_CELL;
  g[start] = 0;
  open.push(start, h(start));
  const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  let found = false, visited = 0;
  while (open.size) {
    const cur = open.pop();
    if (cur === goal) { found = true; break; }
    if (closed[cur]) continue; // veralteter Eintrag, Feld ist schon fertig
    closed[cur] = 1;
    if (++visited > 80_000) break;
    const cx = cur % w, cy = (cur / w) | 0;
    for (const [dx, dy, len] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= nav.h) continue;
      const n = ny * w + nx;
      if (closed[n] || (s[n] === 0 && n !== goal)) continue;
      // Diagonal nicht durch Ecken schneiden
      if (dx && dy && (s[cy * w + nx] === 0 || s[ny * w + cx] === 0)) continue;
      // Der Schritt muss auch auf dem feinen Raster frei sein, sonst hält die Kollision die Einheit auf
      if (!stepFree(nav, opt.mobility, cx, cy, nx, ny)) continue;
      const ng = g[cur] + len * NAV_CELL * (cost(cur) + cost(n)) / 2;
      if (ng < g[n]) { g[n] = ng; came[n] = cur; open.push(n, ng + h(n)); }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map(c => ({ x: ((c % w) + 0.5) * NAV_CELL, y: (((c / w) | 0) + 0.5) * NAV_CELL }));
  // Genauen Zielpunkt nur übernehmen, wenn das letzte Stück frei ist; sonst bleibt die Zellmitte das Ziel
  const lastCenter = pts[pts.length - 1];
  if (segmentFree(nav, opt.mobility, lastCenter, goalPt)) pts[pts.length - 1] = goalPt;
  return smooth(nav, opt, [from, ...pts]).slice(1);
}

// Wegglättung: Zwischenpunkte weglassen, wenn die gerade Linie nicht länger dauert als der Weg darüber.
// Die Linie wird in Fahrzeugbreite geprüft (Mitte und beide Seiten), damit keine Hausecken geschnitten werden.
function smooth(nav: NavGrid, opt: PathOptions, pts: { x: number; y: number }[]) {
  const s = nav.speed[opt.mobility], pen = nav.penalty[opt.mobility];
  const half = opt.mobility === 'foot' ? 1 : 3; // halbe Breite plus etwas Luft, in Metern
  const dg = opt.danger;
  const cellCost = (c: number) => (1 / Math.max(s[c], 0.05)) * (opt.preferRoads && !nav.road[c] ? 1.25 : 1) * (1 + pen[c]) * (dg ? 1 + dg[c] : 1);
  const lineCost = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(len / 2));
    const nx = len ? -(b.y - a.y) / len : 0, ny = len ? (b.x - a.x) / len : 0;
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const x = a.x + ((b.x - a.x) * i) / steps, y = a.y + ((b.y - a.y) * i) / steps;
      if (!freeAt(nav, opt.mobility, x, y) || !freeAt(nav, opt.mobility, x + nx * half, y + ny * half) || !freeAt(nav, opt.mobility, x - nx * half, y - ny * half)) return Infinity;
      sum += cellCost(cellOf(nav, x, y));
    }
    return (sum / (steps + 1)) * len;
  };
  const seg = pts.slice(1).map((p, i) => Math.min(lineCost(pts[i], p), 1e9)); // Originalabschnitte (Rasterweg gilt immer als machbar)
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let best = i + 1, along = 0;
    for (let j = i + 1; j < pts.length && j <= i + 60; j++) {
      along += seg[j - 1];
      if (j > i + 1 && lineCost(pts[i], pts[j]) <= along * 1.02) best = j;
    }
    out.push(pts[best]);
    i = best;
  }
  return out;
}
