// Zeichnet die Karte im Stil einer taktischen Karte: gedeckte Farben, klare Straßen, dunkle Häuser.
// Alles in Metern; die Kamera skaliert den ganzen Container.

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { GameMap } from './load';
import { TERRAIN, TERRAIN_INFO } from './terrain';

const COLORS = {
  ground: 0xd9d2b4,
  grass: 0xb3c58e,
  field: 0xdccf96,
  scrub: 0x98a873,
  garden: 0xc5cba6,
  forest: 0x5f8a5a,
  forestEdge: 0x47704a,
  water: 0x7fa6c9,
  waterEdge: 0x5a83a8,
  residential: 0xcfc7ad,
  industrial: 0xc4bfb4,
  paved: 0xd9d6cc,
  roadCasing: 0x8c8574,
  road: 0xf4f1e6,
  roadMajor: 0xf2d98c,
  rail: 0x4a4440,
  railTie: 0xe9e4d4,
  building: 0x6e5d52,
  buildingTall: 0x5a4a44,
  buildingEdge: 0x3b302b,
  grid: 0x2b2a22,
};

const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

const pairs = (p: number[]) => p; // Pixi nimmt flache Zahlenlisten [x0, y0, x1, y1, …]

function polyline(g: Graphics, p: number[]) {
  g.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length; i += 2) g.lineTo(p[i], p[i + 1]);
}

export interface MapLayers {
  root: Container;
  raster: Sprite;
  grid: Graphics;
}

export function drawMap(map: GameMap): MapLayers {
  const root = new Container();
  const s = map.size;
  // Inhalt am Kartenrand abschneiden: OSM-Flächen ragen oft darüber hinaus
  const content = new Container();
  const clip = new Graphics().rect(0, 0, s, s).fill(0xffffff);
  content.mask = clip;
  root.addChild(content, clip);

  // Grund
  const ground = new Graphics().rect(0, 0, s, s).fill(COLORS.ground);
  content.addChild(ground);

  // Siedlungsflächen und befestigte Flächen
  const urban = new Graphics();
  for (const a of map.urban) {
    const color = a.k === 'paved' ? COLORS.paved : a.k === 'urban:residential' ? COLORS.residential : COLORS.industrial;
    urban.poly(pairs(a.p)).fill(color);
  }
  content.addChild(urban);

  // Natürliche Flächen: erst offene, dann Wald und Wasser obenauf
  const nature = new Graphics();
  const order = ['grass', 'field', 'garden', 'scrub', 'forest', 'water'];
  for (const kind of order) {
    for (const a of map.areas.filter(x => x.k === kind)) {
      const color = (COLORS as Record<string, number>)[kind];
      if (kind === 'forest') nature.poly(pairs(a.p)).fill(color).stroke({ width: 1.5, color: COLORS.forestEdge });
      else if (kind === 'water') nature.poly(pairs(a.p)).fill(color).stroke({ width: 1, color: COLORS.waterEdge });
      else nature.poly(pairs(a.p)).fill(color);
    }
  }
  content.addChild(nature);

  // Bäche und Flüsse
  const waterways = new Graphics();
  for (const l of map.lines.filter(x => x.k === 'waterway')) {
    polyline(waterways, l.p);
    waterways.stroke({ width: Math.max(1.5, l.w), color: COLORS.water, cap: 'round', join: 'round' });
  }
  content.addChild(waterways);

  // Straßen: erst alle Ränder, dann alle Füllungen, kleine zuerst
  const roads = map.lines.filter(x => x.k === 'road').sort((a, b) => a.w - b.w);
  const casing = new Graphics(), fill = new Graphics();
  for (const l of roads) {
    if (l.w < 3) {
      polyline(fill, l.p);
      fill.stroke({ width: l.w, color: COLORS.roadCasing, alpha: 0.55, cap: 'round', join: 'round' });
      continue;
    }
    polyline(casing, l.p);
    casing.stroke({ width: l.w + 2, color: COLORS.roadCasing, cap: 'round', join: 'round' });
    polyline(fill, l.p);
    fill.stroke({ width: l.w, color: MAJOR.has(l.c) ? COLORS.roadMajor : COLORS.road, cap: 'round', join: 'round' });
  }
  content.addChild(casing, fill);

  // Bahn: dunkle Linie mit hellen Querstrichen-Effekt
  const rail = new Graphics();
  for (const l of map.lines.filter(x => x.k === 'rail')) {
    polyline(rail, l.p);
    rail.stroke({ width: 3.5, color: COLORS.rail, cap: 'butt', join: 'round' });
    polyline(rail, l.p);
    rail.stroke({ width: 1, color: COLORS.railTie, alpha: 0.8, cap: 'butt', join: 'round' });
  }
  content.addChild(rail);

  // Häuser: höhere Häuser dunkler
  const buildings = new Graphics();
  for (const b of map.buildings) {
    buildings.poly(pairs(b.p)).fill(b.h >= 15 ? COLORS.buildingTall : COLORS.building).stroke({ width: 0.8, color: COLORS.buildingEdge });
  }
  content.addChild(buildings);

  // Gelände-Raster zum Prüfen (abschaltbar)
  const canvas = document.createElement('canvas');
  canvas.width = map.grid.w;
  canvas.height = map.grid.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(map.grid.w, map.grid.h);
  map.terrain.forEach((t, i) => {
    const c = TERRAIN_INFO[TERRAIN[t]].color;
    img.data.set([c >> 16, (c >> 8) & 255, c & 255, 255], i * 4);
  });
  ctx.putImageData(img, 0, 0);
  const texture = Texture.from(canvas);
  texture.source.scaleMode = 'nearest';
  const raster = new Sprite(texture);
  raster.width = s;
  raster.height = s;
  raster.alpha = 0.85;
  raster.visible = false;
  content.addChild(raster);

  // Planquadrate: alle 250 m, kräftiger jeden Kilometer
  const grid = new Graphics();
  for (let m = 0; m <= s; m += 250) {
    const strong = m % 1000 === 0;
    grid.moveTo(m, 0).lineTo(m, s).moveTo(0, m).lineTo(s, m);
    grid.stroke({ width: 1, color: COLORS.grid, alpha: strong ? 0.45 : 0.18, pixelLine: true });
  }
  grid.rect(0, 0, s, s).stroke({ width: 2, color: COLORS.grid, alpha: 0.8 });
  root.addChild(grid);

  return { root, raster, grid };
}
