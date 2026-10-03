// Stellungen: gute Verteidigungsplätze je Sektor – Deckung (Haus, Waldrand, Gebüsch) mit freiem Schussfeld
// in Richtung Feind. Wird einmal je Seite berechnet und von der KI genutzt.

import type { Mobility } from '../data/units';
import { NavGrid, freeAt } from './nav';
import type { SightGrid } from './vision';

export interface Position { x: number; y: number; score: number }

const STEP = 16;          // Abstand der geprüften Kandidaten in Metern
const RAYS = 16;          // Blickrichtungen je Kandidat
const VIEW = 900;         // so weit wird das Schussfeld geprüft
const COVER: Record<string, number> = { building: 1, forest: 0.9, scrub: 0.7, garden: 0.6 };

// Wie weit sieht man von hier in Richtung (dx, dy)? Häuser und Wald begrenzen; die ersten 12 m zählen nicht (Fenster, Waldrand)
function viewLength(g: SightGrid, x: number, y: number, dx: number, dy: number, size: number) {
  let cost = 0;
  for (let d = 4; d <= VIEW; d += 4) {
    const px = x + dx * d, py = y + dy * d;
    if (px < 0 || py < 0 || px >= size || py >= size) return d;
    if (d > 12) cost += 4 * (g.cost[Math.floor(py / g.cell) * g.w + Math.floor(px / g.cell)] - 1);
    if (cost > 60) return d;
  }
  return VIEW;
}

// Für alle Zellen eines Sektors (über `inSector`) die besten Stellungen für Infanterie bzw. Fahrzeuge
export function findPositions(
  g: SightGrid, nav: NavGrid, size: number, inSector: (x: number, y: number) => boolean,
  enemy: { x: number; y: number }, mobility: Mobility, count = 8,
): Position[] {
  const found: Position[] = [];
  for (let y = STEP / 2; y < size; y += STEP) for (let x = STEP / 2; x < size; x += STEP) {
    if (!inSector(x, y)) continue;
    const cover = COVER[g.terrainAt(x, y)] ?? 0;
    if (!cover || !freeAt(nav, mobility, x, y)) continue;
    if (mobility !== 'foot' && g.terrainAt(x, y) === 'building') continue;
    // Schussfeld, Blickrichtungen zum Feind zählen doppelt
    const toE = Math.atan2(enemy.y - y, enemy.x - x);
    let view = 0;
    for (let r = 0; r < RAYS; r++) {
      const a = (r / RAYS) * Math.PI * 2;
      const toward = Math.cos(a - toE);
      if (toward < 0) continue;
      view += viewLength(g, x, y, Math.cos(a), Math.sin(a), size) * (0.5 + toward * 1.5);
    }
    if (view < 1500) continue; // nur Deckung ohne Ausblick taugt nicht
    found.push({ x, y, score: view * cover });
  }
  // Die besten nehmen, aber mit Abstand zueinander (sonst alle im selben Haus)
  found.sort((a, b) => b.score - a.score);
  const best: Position[] = [];
  for (const p of found) {
    if (best.every(q => Math.hypot(q.x - p.x, q.y - p.y) > 70)) best.push(p);
    if (best.length >= count) break;
  }
  return best;
}
