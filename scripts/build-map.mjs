// Baut aus den OSM-Rohdaten die Spielkarte: Formen zum Zeichnen plus ein Gelände-Raster für Bewegung,
// Sicht und Deckung. Aufruf: npm run map:build -- ahrensfelde  →  public/maps/<id>.json
// Kartendaten © OpenStreetMap-Mitwirkende, ODbL.

import fs from 'node:fs/promises';
import path from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const id = process.argv[2] || 'ahrensfelde';
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'maps', `${id}.config.json`), 'utf8'));
const RAW = path.join(ROOT, 'maps', id, 'raw');

// ---------- Gelände-Arten (Reihenfolge = Code im Raster) ----------
// Muss zu src/map/terrain.ts passen.
export const TERRAIN = ['open', 'grass', 'field', 'forest', 'scrub', 'garden', 'water', 'road', 'rail', 'building', 'bridge'];
const T = Object.fromEntries(TERRAIN.map((t, i) => [t, i]));

// ---------- Rohdaten einlesen ----------
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '', isArray: n => ['node', 'way', 'relation', 'nd', 'tag', 'member'].includes(n) });
const nodes = new Map(), ways = new Map(), relations = new Map();
for (const file of (await fs.readdir(RAW)).filter(f => f.endsWith('.osm'))) {
  const osm = parser.parse(await fs.readFile(path.join(RAW, file), 'utf8')).osm;
  for (const n of osm.node ?? []) nodes.set(n.id, [+n.lat, +n.lon]);
  for (const w of osm.way ?? []) ways.set(w.id, { refs: (w.nd ?? []).map(nd => nd.ref), tags: tagsOf(w) });
  for (const r of osm.relation ?? []) relations.set(r.id, { members: r.member ?? [], tags: tagsOf(r) });
}
function tagsOf(el) { return Object.fromEntries((el.tag ?? []).map(t => [t.k, t.v])); }
console.log(`${nodes.size} Punkte, ${ways.size} Wege, ${relations.size} Relationen`);

// ---------- Projektion: Grad → Meter, Ursprung oben links ----------
const size = config.sizeMeters;
const mPerDegLat = 111_320;
const mPerDegLon = 111_320 * Math.cos((config.center.lat * Math.PI) / 180);
const north = config.center.lat + size / 2 / mPerDegLat;
const west = config.center.lon - size / 2 / mPerDegLon;
const project = ([lat, lon]) => [(lon - west) * mPerDegLon, (north - lat) * mPerDegLat];
const round = v => Math.round(v * 2) / 2;
const wayPoints = w => w.refs.map(r => nodes.get(r)).filter(Boolean).map(project);

// ---------- Einordnen ----------
function areaKind(tags) {
  if (tags.building || tags['building:part']) return 'building';
  if (tags.natural === 'water' || ['reservoir', 'basin'].includes(tags.landuse) || tags.waterway === 'riverbank') return 'water';
  if (tags.landuse === 'forest' || tags.natural === 'wood') return 'forest';
  if (['scrub', 'heath'].includes(tags.natural)) return 'scrub';
  if (['farmland', 'farmyard', 'orchard', 'vineyard', 'greenhouse_horticulture'].includes(tags.landuse)) return 'field';
  if (['meadow', 'grass', 'village_green', 'recreation_ground', 'cemetery', 'brownfield', 'greenfield'].includes(tags.landuse)
    || ['park', 'pitch', 'playground', 'golf_course'].includes(tags.leisure) || tags.natural === 'grassland') return 'grass';
  if (['allotments'].includes(tags.landuse) || tags.leisure === 'garden') return 'garden';
  if (['residential', 'industrial', 'commercial', 'retail', 'railway', 'construction'].includes(tags.landuse)) return 'urban:' + tags.landuse;
  if (tags.amenity === 'parking' || tags.landuse === 'garages') return 'paved';
  return null;
}
const ROAD_WIDTH = {
  motorway: 14, trunk: 12, primary: 11, secondary: 9, tertiary: 8, unclassified: 6, residential: 6, living_street: 5,
  service: 4, track: 3, footway: 2, path: 1.5, cycleway: 2, pedestrian: 4, steps: 2,
};
function lineKind(tags) {
  if (tags.highway && ROAD_WIDTH[tags.highway] && tags.area !== 'yes') return { k: 'road', cls: tags.highway, w: ROAD_WIDTH[tags.highway] };
  if (['rail', 'light_rail', 'tram', 'subway'].includes(tags.railway) && tags.tunnel !== 'yes') return { k: 'rail', cls: tags.railway, w: 4 };
  if (['river', 'canal', 'stream', 'ditch', 'drain'].includes(tags.waterway)) return { k: 'waterway', cls: tags.waterway, w: tags.waterway === 'river' ? 20 : tags.waterway === 'canal' ? 12 : 2 };
  return null;
}

const areas = [], lines = [], buildings = [];
const closed = w => w.refs.length > 3 && w.refs[0] === w.refs[w.refs.length - 1];
for (const w of ways.values()) {
  const pts = wayPoints(w);
  if (pts.length < 2) continue;
  const kind = closed(w) ? areaKind(w.tags) : null;
  if (kind === 'building') {
    const levels = parseFloat(w.tags['building:levels']) || (w.tags.building === 'apartments' ? 6 : 2);
    buildings.push({ h: Math.round(levels * 3), pts });
  } else if (kind) {
    areas.push({ k: kind, pts });
  }
  const line = lineKind(w.tags);
  if (line) lines.push({ ...line, bridge: w.tags.bridge && w.tags.bridge !== 'no' ? 1 : 0, name: w.tags.name, pts });
}
// Multipolygone (große Wälder, Seen): äußere Ringe als Flächen
for (const r of relations.values()) {
  if (r.tags.type !== 'multipolygon') continue;
  const kind = areaKind(r.tags);
  if (!kind) continue;
  for (const m of r.members) {
    if (m.type !== 'way' || m.role === 'inner') continue;
    const w = ways.get(m.ref);
    if (!w) continue;
    const pts = wayPoints(w);
    if (pts.length < 3) continue;
    if (kind === 'building') buildings.push({ h: 6, pts }); else areas.push({ k: kind, pts });
  }
}
console.log(`${areas.length} Flächen, ${lines.length} Linien, ${buildings.length} Häuser`);

// ---------- Gelände-Raster ----------
const cell = config.cellMeters, gw = Math.round(size / cell), gh = gw;
const grid = new Uint8Array(gw * gh).fill(T.open);

function fillPolygon(pts, code, only) {
  let minY = Infinity, maxY = -Infinity;
  for (const [, y] of pts) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const y0 = Math.max(0, Math.floor(minY / cell)), y1 = Math.min(gh - 1, Math.floor(maxY / cell));
  for (let gy = y0; gy <= y1; gy++) {
    const cy = (gy + 0.5) * cell, xs = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > cy) !== (yj > cy)) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] / cell - 0.5)), xb = Math.min(gw - 1, Math.floor(xs[k + 1] / cell - 0.5));
      for (let gx = xa; gx <= xb; gx++) {
        const i = gy * gw + gx;
        if (!only || only.includes(grid[i])) grid[i] = code;
      }
    }
  }
}
function strokeLine(pts, width, code) {
  const r = Math.max(width / 2, cell * 0.6);
  for (let s = 1; s < pts.length; s++) {
    const [ax, ay] = pts[s - 1], [bx, by] = pts[s];
    const x0 = Math.max(0, Math.floor((Math.min(ax, bx) - r) / cell)), x1 = Math.min(gw - 1, Math.floor((Math.max(ax, bx) + r) / cell));
    const y0 = Math.max(0, Math.floor((Math.min(ay, by) - r) / cell)), y1 = Math.min(gh - 1, Math.floor((Math.max(ay, by) + r) / cell));
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const px = (gx + 0.5) * cell, py = (gy + 0.5) * cell;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px, ey = ay + t * dy - py;
      if (ex * ex + ey * ey <= r * r) grid[gy * gw + gx] = code;
    }
  }
}
// Reihenfolge: Grundflächen, dann Wald und Wasser, dann Wege, Häuser zuletzt
const base = { field: T.field, grass: T.grass, garden: T.garden, scrub: T.scrub, 'urban:residential': T.garden };
for (const a of areas) if (base[a.k] !== undefined) fillPolygon(a.pts, base[a.k]);
for (const a of areas) if (a.k === 'forest') fillPolygon(a.pts, T.forest);
for (const a of areas) if (a.k === 'paved') fillPolygon(a.pts, T.road);
for (const a of areas) if (a.k === 'water') fillPolygon(a.pts, T.water);
// Kleine Bäche und Gräben sind schwieriges, aber passierbares Gelände; nur Flüsse und Kanäle sind Wasser
for (const l of lines) if (l.k === 'waterway') strokeLine(l.pts, l.w, l.w >= 5 ? T.water : T.scrub);
for (const l of lines) if (l.k === 'rail') strokeLine(l.pts, l.w, T.rail);
for (const l of lines) if (l.k === 'road' && l.w >= 3) strokeLine(l.pts, l.w, l.bridge ? T.bridge : T.road);
for (const b of buildings) fillPolygon(b.pts, T.building);
const counts = TERRAIN.map((t, i) => `${t} ${Math.round((grid.filter(v => v === i).length / grid.length) * 100)} %`);
console.log(`Raster ${gw} × ${gh}: ${counts.join(', ')}`);

// ---------- Speichern ----------
const inside = pts => pts.some(([x, y]) => x > -200 && y > -200 && x < size + 200 && y < size + 200);
const flat = pts => pts.flatMap(([x, y]) => [round(x), round(y)]);
const out = {
  id, name: config.name, description: config.description, size, cell,
  origin: { lat: north, lon: west },
  attribution: '© OpenStreetMap-Mitwirkende (ODbL)',
  terrain: TERRAIN,
  areas: areas.filter(a => inside(a.pts) && !a.k.startsWith('urban') && a.k !== 'paved').map(a => ({ k: a.k, p: flat(a.pts) })),
  urban: areas.filter(a => inside(a.pts) && (a.k.startsWith('urban') || a.k === 'paved')).map(a => ({ k: a.k, p: flat(a.pts) })),
  lines: lines.filter(l => inside(l.pts)).map(l => ({ k: l.k, c: l.cls, w: l.w, b: l.bridge, n: l.name, p: flat(l.pts) })),
  buildings: buildings.filter(b => inside(b.pts)).map(b => ({ h: b.h, p: flat(b.pts) })),
  grid: { w: gw, h: gh, data: Buffer.from(grid).toString('base64') },
};
await fs.mkdir(path.join(ROOT, 'public', 'maps'), { recursive: true });
const file = path.join(ROOT, 'public', 'maps', `${id}.json`);
await fs.writeFile(file, JSON.stringify(out));
console.log(`→ public/maps/${id}.json (${((await fs.stat(file)).size / 1e6).toFixed(1)} MB)`);
