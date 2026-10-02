// Gelände-Arten im Raster. Reihenfolge muss zu scripts/build-map.mjs passen.

export const TERRAIN = ['open', 'grass', 'field', 'forest', 'scrub', 'garden', 'water', 'road', 'rail', 'building', 'bridge'] as const;
export type Terrain = typeof TERRAIN[number];

// Was das Gelände für Bewegung und Deckung bedeutet (wird in späteren Schritten genutzt)
export const TERRAIN_INFO: Record<Terrain, { name: string; cover: string; color: number }> = {
  open: { name: 'Offenes Gelände', cover: 'keine Deckung', color: 0xd6ceaa },
  grass: { name: 'Wiese', cover: 'keine Deckung', color: 0xaac482 },
  field: { name: 'Feld', cover: 'kaum Deckung', color: 0xe2d28c },
  forest: { name: 'Wald', cover: 'gute Deckung, verbirgt', color: 0x467846 },
  scrub: { name: 'Gebüsch', cover: 'leichte Deckung, verbirgt', color: 0x82965a },
  garden: { name: 'Gärten und Höfe', cover: 'leichte Deckung', color: 0xbec8a0 },
  water: { name: 'Wasser', cover: 'unpassierbar', color: 0x5082be },
  road: { name: 'Straße', cover: 'keine Deckung, schnell', color: 0xebebe1 },
  rail: { name: 'Bahnlinie', cover: 'Damm, leichte Deckung', color: 0x5a5050 },
  building: { name: 'Gebäude', cover: 'sehr gute Deckung für Infanterie', color: 0x785f50 },
  bridge: { name: 'Brücke', cover: 'Engpass', color: 0xc8aa78 },
};
