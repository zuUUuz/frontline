// Gefechte: Sektoren, Anmarschwege, Decks und Regeln je Karte.
// Sektoren werden nach dem nächstgelegenen Mittelpunkt aufgeteilt (jeder Punkt der Karte gehört zu einem Sektor).

import type { Side } from '../sim/world';
import { unitType } from './units';

export interface SectorDef { name: string; x: number; y: number }
// Eine Karte im Deck: Einheit, Stückzahl und ggf. die Infanterie, die im Transporter mitfährt
export interface Card { unit: string; count: number; passengers?: string }
export const cardKey = (c: Card) => (c.passengers ? `${c.unit}+${c.passengers}` : c.unit);
export const cardCost = (c: Card) => unitType(c.unit).cost + (c.passengers ? unitType(c.passengers).cost : 0);
export const cardName = (c: Card) => unitType(c.unit).name + (c.passengers ? ` + ${unitType(c.passengers).name}` : '');

export interface Scenario {
  name: string;
  sectors: SectorDef[];
  entries: Record<Side, { x: number; y: number }[]>; // hier kommen Verstärkungen auf die Karte
  decks: Record<Side, Card[]>;
  startPoints: number;   // Kommandopunkte zu Beginn
  income: number;        // Kommandopunkte pro Sekunde
  incomePerSector: number; // zusätzlich je gehaltenem Sektor pro Sekunde
  winScore: number;      // Siegpunkte zum Sieg
  scorePerSector: number; // Siegpunkte je gehaltenem Sektor pro Sekunde
}

export const AHRENSFELDE: Scenario = {
  name: 'Kampf um Ahrensfelde',
  sectors: [
    { name: 'Rieselfelder', x: 300, y: 350 },
    { name: 'Siedlung Falkenberg', x: 330, y: 1500 },
    { name: 'Gehrensee', x: 900, y: 750 },
    { name: 'S-Bahnhof', x: 1000, y: 1450 },
    { name: 'Dorfkern', x: 1700, y: 700 },
    { name: 'Havemann-Center', x: 1500, y: 1700 },
  ],
  entries: {
    blue: [{ x: 40, y: 500 }, { x: 40, y: 1180 }, { x: 40, y: 1700 }],
    red: [{ x: 1960, y: 470 }, { x: 1960, y: 1100 }, { x: 1960, y: 1600 }],
  },
  decks: {
    blue: [
      { unit: 'fennek', count: 3 }, { unit: 'pzgren', count: 2 }, { unit: 'mells', count: 3 },
      { unit: 'boxer', count: 3, passengers: 'pzgren' }, { unit: 'puma', count: 4, passengers: 'pzgren' }, { unit: 'leopard2a7', count: 4 },
    ],
    red: [
      { unit: 'tigr', count: 3 }, { unit: 'motostrelki', count: 2 }, { unit: 'kornet', count: 3 },
      { unit: 'btr82a', count: 3, passengers: 'motostrelki' }, { unit: 'bmp3', count: 4, passengers: 'motostrelki' }, { unit: 't90m', count: 4 },
    ],
  },
  startPoints: 500,
  income: 1,
  incomePerSector: 0.4,
  winScore: 1200,
  scorePerSector: 0.5, // 4 von 6 Sektoren halten: Sieg nach 10 Minuten
};
