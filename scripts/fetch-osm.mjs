// Lädt die OpenStreetMap-Rohdaten für eine Karte über die offizielle OSM-API (in Kacheln von 1 × 1 km,
// weil die API pro Abfrage begrenzt ist). Aufruf: npm run map:fetch -- ahrensfelde
// Die Rohdaten landen in maps/<id>/raw/ und werden nicht ins Repo eingecheckt.
// Kartendaten © OpenStreetMap-Mitwirkende, ODbL.

import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const id = process.argv[2] || 'ahrensfelde';
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'maps', `${id}.config.json`), 'utf8'));
const RAW = path.join(ROOT, 'maps', id, 'raw');
await fs.mkdir(RAW, { recursive: true });

// Meter in Grad umrechnen (genau genug für ein paar Kilometer)
const mPerDegLat = 111_320;
const mPerDegLon = 111_320 * Math.cos((config.center.lat * Math.PI) / 180);
const half = config.sizeMeters / 2 + 100; // etwas Rand, damit Straßen am Kartenrand nicht abbrechen
const south = config.center.lat - half / mPerDegLat, north = config.center.lat + half / mPerDegLat;
const west = config.center.lon - half / mPerDegLon, east = config.center.lon + half / mPerDegLon;

const tiles = 2;
for (let ty = 0; ty < tiles; ty++) {
  for (let tx = 0; tx < tiles; tx++) {
    const file = path.join(RAW, `tile-${tx}-${ty}.osm`);
    try { await fs.access(file); console.log(`= ${path.basename(file)} schon da`); continue; } catch { /* laden */ }
    const w = west + ((east - west) * tx) / tiles, e = west + ((east - west) * (tx + 1)) / tiles;
    const s = south + ((north - south) * ty) / tiles, n = south + ((north - south) * (ty + 1)) / tiles;
    const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${w.toFixed(6)},${s.toFixed(6)},${e.toFixed(6)},${n.toFixed(6)}`;
    process.stdout.write(`… Kachel ${tx},${ty} `);
    const res = await fetch(url, { headers: { 'User-Agent': 'frontline-mapbuilder/0.1 (hobby game, one-time download)' } });
    if (!res.ok) throw new Error(`OSM-API ${res.status}: ${await res.text()}`);
    const text = await res.text();
    await fs.writeFile(file, text);
    console.log(`→ ${(text.length / 1e6).toFixed(1)} MB`);
    await new Promise(r => setTimeout(r, 1500)); // freundlich zur API
  }
}
console.log('Fertig.');
