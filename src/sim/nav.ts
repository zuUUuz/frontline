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
}

// Aus dem 4-m-Gelände das 8-m-Navigationsraster bauen: Mittelwert der Teilzellen,
// unpassierbar, wenn mehr als die Hälfte unpassierbar ist
export function buildNav(map: GameMap): NavGrid {
  const k = Math.round(NAV_CELL / map.cell), w = Math.floor(map.grid.w / k), h = Math.floor(map.grid.h / k);
  const mob: Mobility[] = ['tracked', 'wheeled', 'foot'];
  const speed = Object.fromEntries(mob.map(m => [m, new Float32Array(w * h)])) as NavGrid['speed'];
  const road = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sums = { tracked: 0, wheeled: 0, foot: 0 }, blocked = { tracked: 0, wheeled: 0, foot: 0 };
    let roads = 0;
    for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) {
      const t = TERRAIN[map.terrain[(y * k + dy) * map.grid.w + x * k + dx]];
      if (ON_ROAD.has(t)) roads++;
      for (const m of mob) { const s = SPEED[m][t]; sums[m] += s; if (s === 0) blocked[m]++; }
    }
    const i = y * w + x, n = k * k;
    for (const m of mob) speed[m][i] = blocked[m] * 2 > n ? 0 : sums[m] / n;
    road[i] = roads * 2 >= n ? 1 : 0;
  }
  return { w, h, speed, road };
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
      const d = dx * dx + dy * dy;
      if (!best || d < best.d) best = { x: (gx + 0.5) * NAV_CELL, y: (gy + 0.5) * NAV_CELL, d };
    }
    if (best) return r === 0 ? { x, y } : { x: best.x, y: best.y };
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
  const cost = (i: number) => (1 / Math.max(s[i], 0.05)) * (opt.preferRoads && !nav.road[i] ? 1.25 : 1);
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
      const ng = g[cur] + len * NAV_CELL * (cost(cur) + cost(n)) / 2;
      if (ng < g[n]) { g[n] = ng; came[n] = cur; open.push(n, ng + h(n)); }
    }
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = goal; c !== -1; c = came[c]) cells.push(c);
  cells.reverse();
  const pts = cells.map(c => ({ x: ((c % w) + 0.5) * NAV_CELL, y: (((c / w) | 0) + 0.5) * NAV_CELL }));
  pts[pts.length - 1] = goalPt;
  return smooth(nav, opt, [from, ...pts]).slice(1);
}

// Wegglättung: Zwischenpunkte weglassen, wenn die gerade Linie nicht länger dauert als der Weg darüber
// und nirgends unpassierbar ist. Ergibt ruhige, gerade Strecken statt Rasterzickzack.
function smooth(nav: NavGrid, opt: PathOptions, pts: { x: number; y: number }[]) {
  const s = nav.speed[opt.mobility];
  const cellCost = (c: number) => (1 / Math.max(s[c], 0.05)) * (opt.preferRoads && !nav.road[c] ? 1.25 : 1);
  // Zeitkosten einer geraden Linie; Infinity, wenn sie durch Unpassierbares führt
  const lineCost = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(len / (NAV_CELL / 2)));
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const c = cellOf(nav, a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
      if (s[c] === 0) return Infinity;
      sum += cellCost(c);
    }
    return (sum / (steps + 1)) * len;
  };
  const seg = pts.slice(1).map((p, i) => lineCost(pts[i], p)); // Kosten der Originalabschnitte
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
