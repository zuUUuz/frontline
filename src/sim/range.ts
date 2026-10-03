// Schießstand: feste Duelle auf dem langen Wiesenstreifen am Westrand der Karte (freie Sicht über 1 km).
// Jede Einheit schießt nur auf ihren Duellpartner.

import type { World } from './world';

export interface Duel { name: string; blue: string; red: string; dist: number; redHeading?: number }

const LANE_X = 75, LANE_Y = 750;

export const DUELS: Duel[] = [
  { name: 'Leopard 2A7 gegen T-90M, von vorn', blue: 'leopard2a7', red: 't90m', dist: 1000 },
  { name: 'Leopard 2A7 gegen T-90M, T-90 zeigt die Seite', blue: 'leopard2a7', red: 't90m', dist: 1000, redHeading: 0 },
  { name: 'MELLS-Trupp gegen T-90M', blue: 'mells', red: 't90m', dist: 1000 },
  { name: 'Kornet-Trupp gegen Leopard 2A7', blue: 'leopard2a7', red: 'kornet', dist: 1000 },
  { name: 'Puma gegen BMP-3', blue: 'puma', red: 'bmp3', dist: 1000 },
  { name: 'Puma gegen T-90M', blue: 'puma', red: 't90m', dist: 1000 },
  { name: 'Fennek gegen GAZ Tigr', blue: 'fennek', red: 'tigr', dist: 1000 },
  { name: 'Panzergrenadiere gegen Motschützen', blue: 'pzgren', red: 'motostrelki', dist: 300 },
];

export function setupDuel(w: World, d: Duel) {
  w.reset();
  w.wander = false;
  const b = w.spawn(d.blue, 'blue', LANE_X, LANE_Y + d.dist / 2, -Math.PI / 2);
  const r = w.spawn(d.red, 'red', LANE_X, LANE_Y - d.dist / 2, d.redHeading ?? Math.PI / 2);
  b.duelWith = r.id;
  r.duelWith = b.id;
  return { blue: b, red: r, center: { x: LANE_X, y: LANE_Y } };
}
