// Lädt eine aufbereitete Karte aus public/maps/ (gebaut mit npm run map:build).

import { TERRAIN, Terrain } from './terrain';

export interface MapData {
  id: string;
  name: string;
  description: string;
  size: number; // Kantenlänge in Metern
  cell: number; // Rasterzelle in Metern
  attribution: string;
  areas: { k: string; p: number[] }[];
  urban: { k: string; p: number[] }[];
  lines: { k: string; c: string; w: number; b: number; n?: string; p: number[] }[];
  buildings: { h: number; p: number[] }[];
  grid: { w: number; h: number; data: string };
}

export interface GameMap extends MapData {
  terrain: Uint8Array;
  terrainAt: (x: number, y: number) => Terrain;
}

export async function loadMap(id: string): Promise<GameMap> {
  const res = await fetch(`./maps/${id}.json`);
  if (!res.ok) throw new Error(`Karte ${id} nicht gefunden`);
  const data: MapData = await res.json();
  const terrain = Uint8Array.from(atob(data.grid.data), c => c.charCodeAt(0));
  const terrainAt = (x: number, y: number): Terrain => {
    const gx = Math.floor(x / data.cell), gy = Math.floor(y / data.cell);
    if (gx < 0 || gy < 0 || gx >= data.grid.w || gy >= data.grid.h) return 'open';
    return TERRAIN[terrain[gy * data.grid.w + gx]];
  };
  return { ...data, terrain, terrainAt };
}
